package backup

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"sync"
	"time"

	"carino.systems/topo/server/internal/store"
)

// When it writes (D102, A5 and amendments 7-9):
//   - Touch(site) after every push (internal/api, after the commit): the
//     site is written once it has been quiet for Debounce (2 minutes; 30 s
//     after a visit), and at most MaxWait (15 minutes) after the first
//     touch, so a long editing session still gets a backup every 15 minutes;
//   - every day at the set time, every network whose head is newer than its
//     newest backup on this destination; one that did not change is not
//     written again (its newest file is always kept, D103);
//   - at start and whenever the destination changes, every network that is
//     behind (a restart inside the quiet spell loses nothing);
//   - one job at a time, networks in order, never in parallel.
const (
	MaxWait    = 15 * time.Minute
	VisitWait  = 30 * time.Second
	CheckEvery = 7 * 24 * time.Hour
	leaseFor   = 5 * time.Minute
)

// Backoff after a failure that stops a run (unreachable, refused, full,
// not there): 5, 15 and 60 minutes, then the next daily time (amendment 8).
var Backoff = []time.Duration{5 * time.Minute, 15 * time.Minute, time.Hour}

// Options configure an Engine.
type Options struct {
	Store  *store.Store
	Blobs  store.Blobs
	Key    []byte // server.key (seals the destination's secrets)
	Origin string // the public origin (originHash in every file)
	Roots  []string
	// Debounce is the quiet spell after a push (TOPO_BACKUP_DEBOUNCE).
	Debounce time.Duration
	Tick     time.Duration
	Now      func() time.Time
	Loc      *time.Location
	Log      *slog.Logger
	// Wake tells the mail worker a failure mail is queued.
	Wake func()
	// Open opens the destination; nil is OpenDest. Tests pass fakes.
	Open func(s Settings, configID string, requireMarker bool) (Dest, error)
}

// Engine runs backups for one server.
type Engine struct {
	o     Options
	owner string // lease holder id

	mu         sync.Mutex
	pending    map[string]*pend
	readable   map[string]*readableJob
	seenConfig string
	runReq     bool
	checkReq   bool
	kick       chan struct{}

	runMu sync.Mutex // one run at a time
}

type pend struct {
	first, last time.Time
	visit       bool
	now         bool   // due at once (start, a new destination, a failure)
	fresh       bool   // write even when the head did not move (new keys or escrow)
	gen         uint64 // bumped by every Touch/TouchNow; a write that took an older gen keeps the entry
	taken       bool   // a write took this entry; the next Touch restarts first
}

type readableJob struct {
	revN int64
	name string
	body []byte
}

// New makes an engine; Run starts its loop.
func New(o Options) *Engine {
	if o.Now == nil {
		o.Now = time.Now
	}
	if o.Loc == nil {
		o.Loc = time.Local
	}
	if o.Log == nil {
		o.Log = slog.New(slog.DiscardHandler)
	}
	if o.Tick <= 0 {
		o.Tick = 30 * time.Second
	}
	if o.Blobs == nil && o.Store != nil {
		o.Blobs = store.DBBlobs{R: o.Store.R}
	}
	b := make([]byte, 9)
	rand.Read(b)
	return &Engine{o: o, owner: "e_" + base64.RawURLEncoding.EncodeToString(b), pending: map[string]*pend{}, readable: map[string]*readableJob{}, kick: make(chan struct{}, 1)}
}

// Owner is the lease holder id of this engine.
func (e *Engine) Owner() string { return e.owner }

// Loc is the time zone days are counted in.
func (e *Engine) Loc() *time.Location { return e.o.Loc }

// Touch notes that site changed (why "visit" waits less). It never blocks
// and is safe on a nil engine.
func (e *Engine) Touch(site, why string) {
	if e == nil || site == "" {
		return
	}
	now := e.o.Now()
	e.mu.Lock()
	p := e.pending[site]
	if p == nil {
		p = &pend{first: now}
		e.pending[site] = p
	}
	if p.taken {
		p.first, p.taken = now, false
	}
	p.last = now
	p.visit = p.visit || why == "visit"
	p.gen++
	e.mu.Unlock()
}

// TouchNow marks sites due at the next tick (keys reset, a new recovery
// key, an owner granted: the next file must carry the current wraps and
// escrows, amendment 2).
func (e *Engine) TouchNow(sites ...string) {
	if e == nil {
		return
	}
	e.mu.Lock()
	for _, s := range sites {
		p := e.pending[s]
		if p == nil {
			p = &pend{first: e.o.Now()}
			e.pending[s] = p
		}
		p.now, p.fresh = true, true
		p.gen++
	}
	e.mu.Unlock()
	e.Kick()
}

// QueueReadable hands the engine a readable copy an owner's browser made
// (D106). It is held in memory only, never in a temporary file, and a newer
// one for the same site replaces it.
func (e *Engine) QueueReadable(site string, revN int64, name string, body []byte) {
	if e == nil {
		return
	}
	e.mu.Lock()
	e.readable[site] = &readableJob{revN: revN, name: name, body: body}
	e.mu.Unlock()
	e.Kick()
}

// RequestRun asks for "Back up now" at the next tick (every changed
// network, backoff ignored).
func (e *Engine) RequestRun() {
	if e == nil {
		return
	}
	e.mu.Lock()
	e.runReq = true
	e.mu.Unlock()
	e.Kick()
}

// RequestCheck asks for "Check now" at the next tick.
func (e *Engine) RequestCheck() {
	if e == nil {
		return
	}
	e.mu.Lock()
	e.checkReq = true
	e.mu.Unlock()
	e.Kick()
}

// Kick runs a tick soon without waiting for the timer.
func (e *Engine) Kick() {
	if e == nil {
		return
	}
	select {
	case e.kick <- struct{}{}:
	default:
	}
}

// Run ticks until ctx ends, then gives the lease up.
func (e *Engine) Run(ctx context.Context) {
	t := time.NewTicker(e.o.Tick)
	defer t.Stop()
	defer func() {
		rctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		store.ReleaseBackupLease(rctx, e.o.Store.W, e.owner)
	}()
	for {
		if err := e.Tick(ctx); err != nil && ctx.Err() == nil {
			e.o.Log.Error("backups", "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		case <-e.kick:
		}
	}
}

// Lease takes or renews the engine lease; false while another engine (a
// running server, or `topo-server backup-now`) holds it.
func (e *Engine) Lease(ctx context.Context) (bool, error) {
	now := e.o.Now()
	return store.AcquireBackupLease(ctx, e.o.Store.W, e.owner, now.UnixMilli(), now.Add(leaseFor).UnixMilli())
}

// Release gives the lease up.
func (e *Engine) Release(ctx context.Context) error {
	return store.ReleaseBackupLease(ctx, e.o.Store.W, e.owner)
}

// ErrLeased means another engine holds the lease.
var ErrLeased = errors.New("another Topo server is running backups on this data folder")

// Tick does what is due: the networks touched and quiet, the daily run,
// readable copies, the weekly check.
func (e *Engine) Tick(ctx context.Context) error {
	return e.tick(ctx, false)
}

// RunNow backs up every changed network now, ignoring the backoff (the
// "Back up now" button and `topo-server backup-now`). The caller holds the
// lease (Lease).
func (e *Engine) RunNow(ctx context.Context) error {
	return e.tick(ctx, true)
}

func (e *Engine) tick(ctx context.Context, force bool) error {
	e.runMu.Lock()
	defer e.runMu.Unlock()
	if ok, err := e.Lease(ctx); err != nil || !ok {
		if err == nil && force {
			return ErrLeased
		}
		return err
	}
	cfg, err := store.GetBackupConfig(ctx, e.o.Store.R)
	if err != nil {
		return err
	}
	if !cfg.Enabled || cfg.Kind == "" {
		return nil
	}
	st, err := store.GetBackupState(ctx, e.o.Store.R)
	if err != nil {
		return err
	}
	now := e.o.Now()

	e.mu.Lock()
	if e.runReq {
		force, e.runReq = true, false
	}
	checkReq := e.checkReq
	e.checkReq = false
	newConfig := e.seenConfig != cfg.ConfigID
	e.seenConfig = cfg.ConfigID
	e.mu.Unlock()

	// At start and on a new destination: every network that is behind.
	if newConfig || force {
		changed, err := store.ChangedSites(ctx, e.o.Store.R, cfg.ConfigID)
		if err != nil {
			return err
		}
		e.mu.Lock()
		for _, s := range changed {
			p := e.pending[s]
			if p == nil {
				p = &pend{first: now}
				e.pending[s] = p
			}
			p.now = true
		}
		e.mu.Unlock()
	}
	// The daily run: keyed by the local date, so a DST day runs it once.
	today := now.In(e.o.Loc).Format("2006-01-02")
	daily := false
	if h, m, ok := ParseDailyAt(cfg.DailyAt); ok && st.LastDailyDate != today {
		lt := now.In(e.o.Loc)
		if lt.Hour()*60+lt.Minute() >= h*60+m {
			daily = true
		}
	}
	if daily {
		changed, err := store.ChangedSites(ctx, e.o.Store.R, cfg.ConfigID)
		if err != nil {
			return err
		}
		e.mu.Lock()
		for _, s := range changed {
			p := e.pending[s]
			if p == nil {
				p = &pend{first: now}
				e.pending[s] = p
			}
			p.now = true
		}
		e.mu.Unlock()
		st.LastDailyDate = today
		if err := store.SetBackupState(ctx, e.o.Store.W, st); err != nil {
			return err
		}
	}

	due := e.due(now)
	e.mu.Lock()
	var readable []string
	for s := range e.readable {
		readable = append(readable, s)
	}
	e.mu.Unlock()
	checkDue := checkReq || (st.LastCheckAt > 0 && now.Sub(time.UnixMilli(st.LastCheckAt)) >= CheckEvery)
	backingOff := !force && st.BackoffUntil > now.UnixMilli()
	if backingOff && !checkReq {
		return nil
	}
	if len(due) == 0 && len(readable) == 0 && !checkDue {
		return nil
	}

	d, err := e.open(cfg, true)
	if err != nil {
		return e.failed(ctx, "backup-failed", CodeOf(err), err)
	}
	var runErr error
	wrote := false
	if !backingOff {
		for _, site := range due {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if _, err := e.Lease(ctx); err != nil {
				return err
			}
			fresh, took := e.take(site)
			ok, err := e.writeSite(ctx, d, cfg, site, fresh)
			e.done(site, took, err == nil)
			if err != nil {
				runErr = err
				e.o.Log.Warn("backup not written", "site", site, "code", CodeOf(err), "err", err)
				if stops(CodeOf(err)) {
					break // the rest stay due
				}
				continue
			}
			wrote = wrote || ok
		}
		if runErr == nil {
			for _, site := range readable {
				if err := e.writeReadable(ctx, d, cfg, site); err != nil {
					runErr = err
					e.o.Log.Warn("readable copy not written", "site", site, "code", CodeOf(err), "err", err)
					if stops(CodeOf(err)) {
						break
					}
				}
			}
		}
		if runErr != nil {
			if err := e.failed(ctx, "backup-failed", CodeOf(runErr), runErr); err != nil {
				return err
			}
		} else if wrote || len(due) > 0 {
			if err := e.succeeded(ctx); err != nil {
				return err
			}
		}
	}
	if checkDue && (runErr == nil || checkReq) {
		return e.check(ctx, d, cfg)
	}
	return nil
}

// due lists the sites whose quiet spell is over, in a stable order.
// taken is what a write consumed from a pending entry.
type taken struct {
	ok         bool
	gen        uint64
	first      time.Time
	now, fresh bool
	visit      bool
}

// take consumes the flags of site's pending entry for one write. A Touch or
// TouchNow that lands while the write runs bumps gen, so done keeps the
// entry for the next tick instead of losing it.
func (e *Engine) take(site string) (bool, taken) {
	e.mu.Lock()
	defer e.mu.Unlock()
	p := e.pending[site]
	if p == nil {
		return false, taken{}
	}
	t := taken{ok: true, gen: p.gen, first: p.first, now: p.now, fresh: p.fresh, visit: p.visit}
	p.now, p.fresh, p.visit, p.taken = false, false, false, true
	return t.fresh, t
}

// done settles site's pending entry after a write took it.
func (e *Engine) done(site string, t taken, ok bool) {
	if !t.ok {
		return
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	p := e.pending[site]
	if p == nil {
		return
	}
	if !ok {
		// Not written: give back what was consumed and keep the original start.
		p.now, p.fresh, p.visit = p.now || t.now, p.fresh || t.fresh, p.visit || t.visit
		if t.first.Before(p.first) {
			p.first = t.first
		}
		p.taken = false
		return
	}
	if p.gen == t.gen {
		delete(e.pending, site)
		return
	}
	// Touched while the file was written: that change is not in it.
	p.taken = false
}

func (e *Engine) due(now time.Time) []string {
	e.mu.Lock()
	defer e.mu.Unlock()
	var out []string
	for s, p := range e.pending {
		quiet := e.o.Debounce
		if p.visit && VisitWait < quiet {
			quiet = VisitWait
		}
		if p.now || now.Sub(p.last) >= quiet || now.Sub(p.first) >= MaxWait {
			out = append(out, s)
		}
	}
	sortStrings(out)
	return out
}

func sortStrings(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j] < s[j-1]; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}

// open opens the saved destination.
func (e *Engine) open(cfg *store.BackupConfig, requireMarker bool) (Dest, error) {
	s, err := SavedSettings(cfg, e.o.Key)
	if err != nil {
		return nil, err
	}
	if e.o.Open != nil {
		return e.o.Open(s, cfg.ConfigID, requireMarker)
	}
	return OpenDestWith(s, e.o.Roots, cfg.ConfigID, requireMarker, e.Hooks(cfg.ConfigID, cfg.OAuthRef))
}

// Hooks are what a destination opened for configID may save back: a
// rotated refresh token and the Drive folder id, sealed again, and only
// while configID is still the saved destination (5c, amendment 20).
func (e *Engine) Hooks(configID, ref string) Hooks {
	return Hooks{Now: e.o.Now, Ref: ref, Save: func(secrets map[string]string, ref string) error {
		cfg, err := store.GetBackupConfig(context.Background(), e.o.Store.R)
		if err != nil {
			return err
		}
		if cfg.ConfigID != configID {
			return nil // not the saved destination (a Test of new settings)
		}
		sealed, err := SealSecrets(e.o.Key, cfg.Kind, configID, secrets)
		if err != nil {
			return err
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return store.UpdateBackupSecrets(ctx, e.o.Store.W, configID, sealed, ref)
	}}
}

// SavedSettings reads the stored destination (secrets opened with key).
func SavedSettings(cfg *store.BackupConfig, key []byte) (Settings, error) {
	s := Settings{Kind: cfg.Kind, Fields: map[string]string{}}
	if err := json.Unmarshal([]byte(cfg.Fields), &s.Fields); err != nil {
		s.Fields = map[string]string{}
	}
	sec, err := OpenSecrets(key, cfg.Kind, cfg.ConfigID, cfg.SecretCt)
	if err != nil {
		return s, err
	}
	s.Secrets = sec
	return s, nil
}

// OpenDest opens a destination of a known kind (nothing saved back).
func OpenDest(s Settings, roots []string, configID string, requireMarker bool) (Dest, error) {
	return OpenDestWith(s, roots, configID, requireMarker, Hooks{})
}

// OpenDestWith opens a destination with the server's hooks (the clock S3
// signs with; what Drive and OneDrive save back).
func OpenDestWith(s Settings, roots []string, configID string, requireMarker bool, h Hooks) (Dest, error) {
	switch s.Kind {
	case "folder":
		return NewFolder(s.Fields["path"], roots, requireMarker, configID)
	case "webdav":
		return NewWebDAV(s)
	case "s3":
		return NewS3(s, h.Now)
	case "gdrive":
		return NewGDrive(s, h)
	case "onedrive":
		return NewOneDrive(s, h)
	}
	return nil, &FieldError{"kind", "bad"}
}

// writeSite writes one network's backup if its head moved since the
// newest one on this destination (or, fresh, in any case: a key reset, a
// new recovery key or a new owner must reach the next file, amendment 2). It reports whether a file was written.
func (e *Engine) writeSite(ctx context.Context, d Dest, cfg *store.BackupConfig, site string, fresh bool) (bool, error) {
	now := e.o.Now()
	rows, err := store.SiteBackups(ctx, e.o.Store.R, site, "enc", cfg.ConfigID)
	if err != nil {
		return false, err
	}
	b, err := BuildSnapshot(ctx, e.o.Store, e.o.Blobs, site, e.o.Origin, now)
	if errors.Is(err, errNothing) || errors.Is(err, store.ErrNotFound) {
		return false, nil // no revision yet, or the network was deleted
	}
	if err != nil {
		return false, err
	}
	for _, r := range rows {
		if !fresh && !r.Missing && r.RevN >= b.RevN {
			return false, nil // unchanged: not written again
		}
	}
	var listed map[string]bool
	taken := func(name string) bool {
		for _, r := range rows {
			if r.Name == name {
				return true
			}
		}
		if listed == nil {
			listed = map[string]bool{}
			ents, _ := d.List(ctx, site)
			for _, en := range ents {
				listed[en.Name] = true
			}
		}
		return listed[name]
	}
	name := FileName(Stem(b.Slug, site), now, e.o.Loc, taken)
	pctx, cancel := context.WithTimeout(ctx, OpTimeout)
	ref, err := d.Put(pctx, site+"/"+name, b.Body)
	cancel()
	if err != nil {
		return false, err
	}
	row := &store.Backup{ID: store.NewID("b_"), SiteID: site, ConfigID: cfg.ConfigID, Kind: "enc", Name: name, Ref: ref,
		RevN: b.RevN, At: now.UnixMilli(), Size: int64(len(b.Body)), SHA256: b.SHA256}
	if err := store.InsertBackup(ctx, e.o.Store.W, row); err != nil {
		return true, err
	}
	return true, e.prune(ctx, d, cfg, site, "enc")
}

// requeueReadable puts back a readable copy that could not be written,
// unless a newer one for the same site arrived meanwhile.
func (e *Engine) requeueReadable(site string, job *readableJob) {
	e.mu.Lock()
	if e.readable[site] == nil {
		e.readable[site] = job
	}
	e.mu.Unlock()
}

// writeReadable writes a readable copy an owner's browser sent (D106).
func (e *Engine) writeReadable(ctx context.Context, d Dest, cfg *store.BackupConfig, site string) error {
	e.mu.Lock()
	job := e.readable[site]
	delete(e.readable, site)
	e.mu.Unlock()
	if job == nil {
		return nil
	}
	info, err := store.SiteForBackup(ctx, e.o.Store.R, site)
	if errors.Is(err, store.ErrNotFound) {
		return nil
	}
	if err != nil {
		e.requeueReadable(site, job)
		return err
	}
	if !cfg.ReadableAllowed || !info.Readable {
		return nil // turned off meanwhile: dropped
	}
	rows, err := store.SiteBackups(ctx, e.o.Store.R, site, "readable", cfg.ConfigID)
	if err != nil {
		e.requeueReadable(site, job)
		return err
	}
	now := e.o.Now()
	name := Suffixed(strings.TrimSuffix(job.name, ".json"), now, e.o.Loc, func(n string) bool {
		for _, r := range rows {
			if r.Name == n {
				return true
			}
		}
		return false
	})
	pctx, cancel := context.WithTimeout(ctx, OpTimeout)
	ref, err := d.Put(pctx, site+"/readable/"+name, job.body)
	cancel()
	if err != nil {
		e.requeueReadable(site, job)
		return err
	}
	row := &store.Backup{ID: store.NewID("b_"), SiteID: site, ConfigID: cfg.ConfigID, Kind: "readable", Name: name, Ref: ref,
		RevN: job.revN, At: now.UnixMilli(), Size: int64(len(job.body)), SHA256: sha256hex(job.body)}
	if err := store.InsertBackup(ctx, e.o.Store.W, row); err != nil {
		return err
	}
	return e.prune(ctx, d, cfg, site, "readable")
}

func dirOf(site, kind string) string {
	if kind == "readable" {
		return site + "/readable"
	}
	return site
}

// prune applies retention to a site's files of one kind on this
// destination, then reconciles the rows with a listing (missing files are
// marked and shown, amendment A6).
func (e *Engine) prune(ctx context.Context, d Dest, cfg *store.BackupConfig, site, kind string) error {
	rows, err := store.SiteBackups(ctx, e.o.Store.R, site, kind, cfg.ConfigID)
	if err != nil {
		return err
	}
	times := make([]time.Time, len(rows))
	for i, r := range rows {
		times[i] = time.UnixMilli(r.At)
	}
	keep := Keep(times, e.o.Now(), e.o.Loc)
	dir := dirOf(site, kind)
	for i, r := range rows {
		if keep[i] {
			continue
		}
		dctx, cancel := context.WithTimeout(ctx, OpTimeout)
		err := d.Delete(dctx, dir+"/"+r.Name, r.Ref)
		cancel()
		if err == nil || CodeOf(err) == CodeNotFound {
			if err := store.DeleteBackupRow(ctx, e.o.Store.W, r.ID); err != nil {
				return err
			}
			continue
		}
		e.o.Log.Warn("an old backup could not be deleted; tried again next run", "site", site, "code", CodeOf(err))
		if CodeOf(err) == CodeLocked {
			// Shown once in the status, not an error each run (amendment 16).
			if st, serr := store.GetBackupState(ctx, e.o.Store.R); serr == nil && st.DropNote != CodeLocked {
				st.DropNote = CodeLocked
				if err := store.SetBackupState(ctx, e.o.Store.W, st); err != nil {
					return err
				}
			}
		}
		if err := store.SetBackupFlags(ctx, e.o.Store.W, r.ID, r.Missing, true); err != nil {
			return err
		}
	}
	lctx, cancel := context.WithTimeout(ctx, OpTimeout)
	ents, err := d.List(lctx, dir)
	cancel()
	if err != nil {
		return nil // the listing is a courtesy; the next run tries again
	}
	there := map[string]bool{}
	for _, en := range ents {
		there[en.Name] = true
	}
	rows, err = store.SiteBackups(ctx, e.o.Store.R, site, kind, cfg.ConfigID)
	if err != nil {
		return err
	}
	for _, r := range rows {
		if missing := !there[r.Name]; missing != r.Missing {
			if err := store.SetBackupFlags(ctx, e.o.Store.W, r.ID, missing, r.DropPending); err != nil {
				return err
			}
		}
	}
	return nil
}

// succeeded clears the error and the backoff; the first success after a
// failure sends nothing (A8).
func (e *Engine) succeeded(ctx context.Context) error {
	st, err := store.GetBackupState(ctx, e.o.Store.R)
	if err != nil {
		return err
	}
	st.LastOK = e.o.Now().UnixMilli()
	st.LastErr, st.LastErrAt = "", 0
	st.BackoffStep, st.BackoffUntil = 0, 0
	return store.SetBackupState(ctx, e.o.Store.W, st)
}

// failed records a failure (backup-failed or backup-check-failed), backs
// off when the destination as a whole is down, and mails the server
// owners at most once a day per kind.
func (e *Engine) failed(ctx context.Context, kind, code string, cause error) error {
	if code == "" {
		code = CodeOther
	}
	now := e.o.Now()
	st, err := store.GetBackupState(ctx, e.o.Store.R)
	if err != nil {
		return err
	}
	today := now.In(e.o.Loc).Format("2006-01-02")
	mail := false
	if kind == "backup-check-failed" {
		st.LastCheckAt, st.LastCheckOK, st.LastCheckErr = now.UnixMilli(), false, code
		if st.MailedCheckDay != today {
			st.MailedCheckDay, mail = today, true
		}
	} else {
		st.LastErr, st.LastErrAt = code, now.UnixMilli()
		if stops(code) {
			if st.BackoffStep < len(Backoff) {
				st.BackoffUntil = now.Add(Backoff[st.BackoffStep]).UnixMilli()
			} else {
				cfg, _ := store.GetBackupConfig(ctx, e.o.Store.R)
				at := "02:30"
				if cfg != nil {
					at = cfg.DailyAt
				}
				st.BackoffUntil = NextDaily(at, "", now, e.o.Loc).UnixMilli()
			}
			st.BackoffStep++
		}
		if st.MailedFailDay != today {
			st.MailedFailDay, mail = today, true
		}
	}
	e.o.Log.Warn("backup problem", "kind", kind, "code", code, "err", cause)
	if err := store.SetBackupState(ctx, e.o.Store.W, st); err != nil {
		return err
	}
	if mail {
		return e.mailOwners(ctx, kind, code, today)
	}
	return nil
}

// mailOwners queues the failure mail to every server owner: the reason in
// a sentence, no network, no URL, no file name (A8).
func (e *Engine) mailOwners(ctx context.Context, kind, code, day string) error {
	owners, err := store.ServerOwners(ctx, e.o.Store.R)
	if err != nil {
		return err
	}
	now := e.o.Now().UnixMilli()
	data, _ := json.Marshal(map[string]string{"why": code})
	err = e.o.Store.Tx(ctx, func(tx *sql.Tx) error {
		for _, o := range owners {
			m := &store.Mail{ID: store.NewID("o_"), Kind: kind, To: o[1], UserID: o[0], Lang: o[2], Data: string(data),
				Dedupe: fmt.Sprintf("%s|%s|%s", o[0], kind, day), Created: now, SendAfter: now}
			if err := store.InsertMail(ctx, tx, m); err != nil && !isUnique(err) {
				return err
			}
		}
		return nil
	})
	if err == nil && e.o.Wake != nil {
		e.o.Wake()
	}
	return err
}

func isUnique(err error) bool {
	return err != nil && strings.Contains(err.Error(), "UNIQUE")
}

// NextDaily is when the daily run happens next: today at dailyAt unless it
// ran today (lastDate) or the time has passed, then tomorrow.
func NextDaily(dailyAt, lastDate string, now time.Time, loc *time.Location) time.Time {
	h, m, ok := ParseDailyAt(dailyAt)
	if !ok {
		h, m = 2, 30
	}
	lt := now.In(loc)
	at := time.Date(lt.Year(), lt.Month(), lt.Day(), h, m, 0, 0, loc)
	if lastDate == lt.Format("2006-01-02") || (lastDate == "" && !at.After(lt)) {
		at = time.Date(lt.Year(), lt.Month(), lt.Day()+1, h, m, 0, 0, loc)
	}
	if !at.After(lt) {
		return lt
	}
	return at
}

// TestDest opens settings without the marker and runs Check under budget
// (Test and Save in the app: the handler has a 60 s write deadline, so the
// check gets 20 s, amendment 22).
func (e *Engine) TestDest(ctx context.Context, s Settings, configID string, budget time.Duration) (Dest, error) {
	return e.TestDestRef(ctx, s, configID, "", budget)
}

// TestDestRef is TestDest with the saved oauth_ref (the Drive folder).
func (e *Engine) TestDestRef(ctx context.Context, s Settings, configID, ref string, budget time.Duration) (Dest, error) {
	return e.TestDestMarker(ctx, s, configID, ref, budget, false)
}

// TestDestMarker is TestDestRef that, with requireMarker, also needs a
// folder's .topo-backups (an unchanged folder destination: an unplugged
// disk's empty mount point must fail, amendment 13).
func (e *Engine) TestDestMarker(ctx context.Context, s Settings, configID, ref string, budget time.Duration, requireMarker bool) (Dest, error) {
	var d Dest
	var err error
	if e.o.Open != nil {
		d, err = e.o.Open(s, configID, requireMarker)
	} else {
		d, err = OpenDestWith(s, e.o.Roots, configID, requireMarker, e.Hooks(configID, ref))
	}
	if err != nil {
		return nil, err
	}
	cctx, cancel := context.WithTimeout(ctx, budget)
	defer cancel()
	if err := d.Check(cctx); err != nil {
		if cctx.Err() != nil {
			return nil, &Error{Code: CodeUnreachable, Err: err}
		}
		return nil, err
	}
	return d, nil
}

// OpenSaved opens the saved destination (downloads).
func (e *Engine) OpenSaved(ctx context.Context) (Dest, *store.BackupConfig, error) {
	cfg, err := store.GetBackupConfig(ctx, e.o.Store.R)
	if err != nil {
		return nil, nil, err
	}
	if cfg.Kind == "" {
		return nil, cfg, errf(CodeNotFound, "no destination")
	}
	d, err := e.open(cfg, true)
	return d, cfg, err
}

// ReadFile reads a backup back, at most MaxFile bytes.
func ReadFile(ctx context.Context, d Dest, name, ref string) ([]byte, error) {
	rc, err := d.Get(ctx, name, ref)
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	b, err := io.ReadAll(io.LimitReader(rc, MaxFile+1))
	if err != nil {
		return nil, &Error{Code: CodeUnreachable, Err: err}
	}
	if len(b) > MaxFile {
		return nil, errf(CodeTooLarge, "%d bytes", len(b))
	}
	return b, nil
}

// FilePath is where a row's file sits at the destination.
func FilePath(b *store.Backup) string { return dirOf(b.SiteID, b.Kind) + "/" + b.Name }
