package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"time"

	"carino.systems/topo/server/internal/backup"
	"carino.systems/topo/server/internal/store"
)

// Backups (docs/SCOPE.md step 5b, D99-D105). The server owner sets the one
// destination in Account, Backups; a network's owners list its files and
// download them to restore through the merge (the browser opens them).

// Error codes of the backup routes.
const (
	ErrBackupDest   = "backup-dest"               // the destination's check failed; "code" says why
	ErrBackupFolder = "backup-folder-not-allowed" // outside TOPO_BACKUP_FOLDERS
	ErrBackupOff    = "backup-off"                // backups are not turned on
	ErrReadableOff  = "readable-off"              // readable copies are not allowed / not on
	ErrStale        = "stale"                     // the readable copy is not of the head
)

// interactiveCheck bounds the check Test and Save run inside a request
// (amendment 22: handlers have 60 s to answer).
var interactiveCheck = 20 * time.Second

type backupConfigJSON struct {
	Enabled         bool              `json:"enabled"`
	Kind            string            `json:"kind"`
	Fields          map[string]string `json:"fields"`
	SecretsSet      []string          `json:"secretsSet"`
	SecretsError    bool              `json:"secretsError,omitempty"`
	DailyAt         string            `json:"dailyAt"`
	ReadableAllowed bool              `json:"readableAllowed"`
	Updated         int64             `json:"updated"`
	// 5c: Drive and OneDrive. Connected: a refresh token is saved (never
	// returned); Account: who the drive said it is at Connect.
	Connected bool   `json:"connected,omitempty"`
	Account   string `json:"account,omitempty"`
}

type codeAt struct {
	At   int64  `json:"at"`
	Code string `json:"code"`
}

type checkJSON struct {
	At   int64  `json:"at"`
	OK   bool   `json:"ok"`
	Code string `json:"code,omitempty"`
}

type siteBackupsJSON struct {
	Site    string `json:"site"`
	Name    string `json:"name,omitempty"`
	Count   int    `json:"count"`
	Last    int64  `json:"last"`
	Missing int    `json:"missing"`
}

// adminBackups: GET /api/admin/backups.
func (s *Server) adminBackups(w http.ResponseWriter, r *http.Request) {
	v, err := s.backupView(r.Context())
	if err != nil {
		s.internal(w, "backups", err)
		return
	}
	writeJSON(w, http.StatusOK, v)
}

// backupView is what GET /api/admin/backups answers.
func (s *Server) backupView(ctx context.Context) (map[string]any, error) {
	q := s.d.Store.R
	cfg, err := store.GetBackupConfig(ctx, q)
	if err != nil {
		return nil, err
	}
	st, err := store.GetBackupState(ctx, q)
	if err != nil {
		return nil, err
	}
	cj := backupConfigJSON{Enabled: cfg.Enabled, Kind: cfg.Kind, Fields: map[string]string{}, SecretsSet: []string{}, DailyAt: cfg.DailyAt,
		ReadableAllowed: cfg.ReadableAllowed, Updated: cfg.Updated}
	saved, serr := backup.SavedSettings(cfg, s.d.Key)
	cj.Fields = saved.Fields
	if serr != nil {
		cj.SecretsError = true
	}
	for k := range saved.Secrets {
		if k == "refreshToken" {
			cj.Connected = true // a sign-in to the drive is saved (never sent)
			continue
		}
		cj.SecretsSet = append(cj.SecretsSet, k)
	}
	sort.Strings(cj.SecretsSet)
	if cj.Connected {
		cj.Account = backup.ParseRef(cfg.OAuthRef).Account
	}
	status := map[string]any{"markerOwed": cfg.Enabled && cfg.Kind == "folder" && cfg.MarkerOwed, "lastOk": st.LastOK, "lastError": nil, "lastCheck": nil, "nextRun": nil, "backoffUntil": st.BackoffUntil, "dropNote": st.DropNote}
	if st.LastErr != "" {
		status["lastError"] = codeAt{st.LastErrAt, st.LastErr}
	}
	if st.LastCheckAt > 0 {
		status["lastCheck"] = checkJSON{st.LastCheckAt, st.LastCheckOK, st.LastCheckErr}
	}
	if cfg.Enabled {
		status["nextRun"] = backup.NextDaily(cfg.DailyAt, st.LastDailyDate, s.d.Now(), s.backupLoc()).UnixMilli()
	}
	sums, err := store.BackupSummaries(ctx, q, "")
	if err != nil {
		return nil, err
	}
	sites, deleted := []siteBackupsJSON{}, []siteBackupsJSON{}
	for _, b := range sums {
		j := siteBackupsJSON{b.SiteID, b.Name, b.Count, b.Last, b.Missing}
		if b.Deleted {
			deleted = append(deleted, j)
		} else {
			sites = append(sites, j)
		}
	}
	prev, err := store.CountOtherConfigBackups(ctx, q, cfg.ConfigID)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"config": cj, "kinds": backup.Kinds(), "allowedFolders": s.d.Cfg.BackupFolders,
		"status": status, "sites": sites, "deleted": deleted, "previousDest": prev,
		"oauthRedirect": s.d.Cfg.Origin() + oauthCallbackPath,
	}, nil
}

func (s *Server) backupLoc() *time.Location {
	if s.d.Backups != nil {
		return s.d.Backups.Loc()
	}
	return time.Local
}

// backupReq is what Save and Test send. A secret left out keeps the saved
// one, "" clears it (D105).
type backupReq struct {
	Enabled         *bool              `json:"enabled"`
	Kind            *string            `json:"kind"`
	Fields          map[string]string  `json:"fields"`
	Secrets         map[string]*string `json:"secrets"`
	DailyAt         *string            `json:"dailyAt"`
	ReadableAllowed *bool              `json:"readableAllowed"`
}

// merged is the destination a request asks for, on top of the saved one.
type merged struct {
	cfg      store.BackupConfig
	settings backup.Settings
	changed  bool // the destination changed (a new config id)
}

func (s *Server) mergeBackupReq(ctx context.Context, req *backupReq) (*merged, error) {
	cur, err := store.GetBackupConfig(ctx, s.d.Store.R)
	if err != nil {
		return nil, err
	}
	saved, serr := backup.SavedSettings(cur, s.d.Key)
	if serr != nil {
		saved.Secrets = map[string]string{} // unreadable: they must be typed again
	}
	m := &merged{cfg: *cur}
	if req.Enabled != nil {
		m.cfg.Enabled = *req.Enabled
	}
	if req.ReadableAllowed != nil {
		m.cfg.ReadableAllowed = *req.ReadableAllowed
	}
	if req.DailyAt != nil {
		if _, _, ok := backup.ParseDailyAt(*req.DailyAt); !ok {
			return nil, failWith(http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "dailyAt"})
		}
		m.cfg.DailyAt = *req.DailyAt
	}
	kind := cur.Kind
	if req.Kind != nil {
		kind = *req.Kind
	}
	if kind == "" {
		if m.cfg.Enabled {
			return nil, failWith(http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "kind"})
		}
		m.settings = backup.Settings{Fields: map[string]string{}, Secrets: map[string]string{}}
		return m, nil
	}
	if !backup.KnownKind(kind) {
		return nil, failWith(http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "kind"})
	}
	fields := saved.Fields
	if req.Fields != nil || kind != cur.Kind {
		fields = req.Fields
	}
	next := backup.Normalize(backup.Settings{Kind: kind, Fields: fields})
	m.changed = kind != cur.Kind || !sameFields(next.Fields, saved.Fields) || cur.ConfigID == ""
	// Secrets: kept unless the kind or a host field changed (a password is
	// never sent to a new host without being typed again).
	keep := kind == cur.Kind
	for _, f := range backup.HostFields(kind) {
		if next.Fields[f] != saved.Fields[f] {
			keep = false
		}
	}
	if keep {
		for k, v := range saved.Secrets {
			next.Secrets[k] = v
		}
	}
	for _, name := range backup.SecretNames(kind) {
		if v, ok := req.Secrets[name]; ok && v != nil {
			if *v == "" {
				delete(next.Secrets, name)
			} else {
				next.Secrets[name] = *v
			}
		}
	}
	if err := backup.Validate(next, s.d.Cfg.BackupFolders); err != nil {
		var fe *backup.FieldError
		if errors.As(err, &fe) {
			if fe.Code == "not-allowed" {
				return nil, failWith(http.StatusUnprocessableEntity, ErrBackupFolder, map[string]any{"field": fe.Field, "allowed": s.d.Cfg.BackupFolders})
			}
			return nil, failWith(http.StatusBadRequest, ErrBadRequest, map[string]any{"field": fe.Field, "code": fe.Code})
		}
		return nil, err
	}
	m.cfg.Kind = kind
	if m.changed {
		m.cfg.ConfigID = store.NewID("bc_")
		m.cfg.OAuthRef = "" // a new drive or app: a new folder, a new account
	}
	m.settings = next
	return m, nil
}

func sameFields(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}

// destFailure is the 422 a failed check answers: the code, and for a
// certificate the fingerprint presented (to compare and paste).
func destFailure(err error) error {
	extra := map[string]any{"code": backup.CodeOf(err)}
	var be *backup.Error
	if errors.As(err, &be) && be.Fingerprint != "" {
		extra["fingerprint"] = be.Fingerprint
	}
	var fe *backup.FieldError
	if errors.As(err, &fe) {
		if fe.Code == "not-allowed" {
			return failWith(http.StatusUnprocessableEntity, ErrBackupFolder, map[string]any{"field": fe.Field})
		}
		return failWith(http.StatusBadRequest, ErrBadRequest, map[string]any{"field": fe.Field, "code": fe.Code})
	}
	return failWith(http.StatusUnprocessableEntity, ErrBackupDest, extra)
}

// adminPutBackups: PUT /api/admin/backups[?force=1]. With backups on, the
// destination is checked first (write, read back, delete a probe) and saved
// only when that works; force saves anyway (a disk not plugged in yet).
func (s *Server) adminPutBackups(w http.ResponseWriter, r *http.Request) {
	var req backupReq
	if err := decodeBody(w, r, 64<<10, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	ctx := r.Context()
	m, err := s.mergeBackupReq(ctx, &req)
	if err != nil {
		s.answer(w, "backups", err)
		return
	}
	force := r.URL.Query().Get("force") == "1"
	isFolder := m.cfg.Kind == "folder"
	if m.changed || !isFolder {
		m.cfg.MarkerOwed = false
	}
	// A folder's marker is written only for a new or changed destination, or
	// one saved earlier with "Save anyway". An unchanged folder must already
	// carry it: saving again while a USB disk is unplugged must not write a
	// marker into the empty mount point on the system disk (amendment 13).
	writeMarker := isFolder && (m.changed || m.cfg.MarkerOwed)
	if m.cfg.Enabled && !force && s.d.Backups != nil {
		d, err := s.d.Backups.TestDestMarker(ctx, m.settings, m.cfg.ConfigID, m.cfg.OAuthRef, interactiveCheck, isFolder && !writeMarker)
		if err != nil {
			s.answer(w, "backups", destFailure(err))
			return
		}
		// Drive found or made its Topo folder: keep its id (5c).
		if c, ok := d.(backup.Connected); ok {
			m.cfg.OAuthRef = keepAccount(c.Ref(), m.cfg.OAuthRef)
		}
		if f, ok := d.(*backup.Folder); ok && writeMarker {
			if err := f.WriteMarker(); err != nil {
				s.answer(w, "backups", destFailure(err))
				return
			}
			m.cfg.MarkerOwed, writeMarker = false, false
		}
	}
	if writeMarker {
		// Saved anyway, or saved while backups are off: no marker yet, so
		// runs refuse the folder until a save finds it (the status says so).
		m.cfg.MarkerOwed = true
	}
	fields, _ := json.Marshal(m.settings.Fields)
	m.cfg.Fields = string(fields)
	sealed, err := backup.SealSecrets(s.d.Key, m.cfg.Kind, m.cfg.ConfigID, m.settings.Secrets)
	if err != nil {
		s.internal(w, "backups", err)
		return
	}
	m.cfg.SecretCt = sealed
	now := s.d.Now().UnixMilli()
	m.cfg.Updated, m.cfg.UpdatedBy = now, SessionFrom(ctx).UserID
	if err := store.SetBackupConfig(ctx, s.d.Store.W, &m.cfg); err != nil {
		s.internal(w, "backups", err)
		return
	}
	// A saved destination starts the weekly check's clock and forgets the
	// last problem and the backoff (the owner just made it work).
	if st, err := store.GetBackupState(ctx, s.d.Store.R); err == nil {
		if m.changed || m.cfg.Enabled {
			st.LastCheckAt, st.LastCheckOK, st.LastCheckErr = now, true, ""
			st.BackoffStep, st.BackoffUntil = 0, 0
			if m.changed {
				st.LastErr, st.LastErrAt = "", 0
				st.DropNote = "" // a new destination: its own notes
			}
			store.SetBackupState(ctx, s.d.Store.W, st)
		}
	}
	s.d.Backups.Kick()
	s.adminBackups(w, r)
}

// adminTestBackups: POST /api/admin/backups/test: the check on the posted
// settings (on top of the saved ones), nothing saved.
func (s *Server) adminTestBackups(w http.ResponseWriter, r *http.Request) {
	var req backupReq
	if err := decodeBody(w, r, 64<<10, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	ctx := r.Context()
	m, err := s.mergeBackupReq(ctx, &req)
	if err != nil {
		s.answer(w, "backups", err)
		return
	}
	if m.cfg.Kind == "" || s.d.Backups == nil {
		writeError(w, http.StatusConflict, ErrBackupOff, nil)
		return
	}
	needMarker := m.cfg.Kind == "folder" && !m.changed && !m.cfg.MarkerOwed
	if _, err := s.d.Backups.TestDestMarker(ctx, m.settings, m.cfg.ConfigID, m.cfg.OAuthRef, interactiveCheck, needMarker); err != nil {
		s.answer(w, "backups", destFailure(err))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// adminRunBackups: POST /api/admin/backups/run ("Back up now") and
// …/check ("Check now"): 202, the engine does it at once in the
// background; the status in GET shows the outcome.
func (s *Server) adminRunBackups(w http.ResponseWriter, r *http.Request) {
	if !s.backupsOn(w, r) {
		return
	}
	s.d.Backups.RequestRun()
	writeJSON(w, http.StatusAccepted, map[string]any{"ok": true})
}

func (s *Server) adminCheckBackups(w http.ResponseWriter, r *http.Request) {
	if !s.backupsOn(w, r) {
		return
	}
	s.d.Backups.RequestCheck()
	writeJSON(w, http.StatusAccepted, map[string]any{"ok": true})
}

func (s *Server) backupsOn(w http.ResponseWriter, r *http.Request) bool {
	cfg, err := store.GetBackupConfig(r.Context(), s.d.Store.R)
	if err != nil {
		s.internal(w, "backups", err)
		return false
	}
	if !cfg.Enabled || cfg.Kind == "" || s.d.Backups == nil {
		writeError(w, http.StatusConflict, ErrBackupOff, nil)
		return false
	}
	return true
}

type backupFileJSON struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Kind         string `json:"kind"`
	At           int64  `json:"at"`
	RevN         int64  `json:"revN"`
	Size         int64  `json:"size"`
	Missing      bool   `json:"missing"`
	PreviousDest bool   `json:"previousDest"`
}

func (s *Server) backupList(ctx context.Context, site string) ([]backupFileJSON, error) {
	cfg, err := store.GetBackupConfig(ctx, s.d.Store.R)
	if err != nil {
		return nil, err
	}
	rows, err := store.SiteBackups(ctx, s.d.Store.R, site, "", "")
	if err != nil {
		return nil, err
	}
	out := []backupFileJSON{}
	for _, b := range rows {
		out = append(out, backupFileJSON{b.ID, b.Name, b.Kind, b.At, b.RevN, b.Size, b.Missing, b.ConfigID != cfg.ConfigID})
	}
	return out, nil
}

// siteBackups: GET /api/sites/{site}/backups (an owner of the network).
func (s *Server) siteBackups(w http.ResponseWriter, r *http.Request) {
	list, err := s.backupList(r.Context(), r.PathValue("site"))
	if err != nil {
		s.internal(w, "backups", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"backups": list})
}

// siteBackupFile: GET /api/sites/{site}/backups/{id}: the file's bytes from
// the destination. Its ciphertext only: the browser opens it (D107).
func (s *Server) siteBackupFile(w http.ResponseWriter, r *http.Request) {
	s.serveBackupFile(w, r, r.PathValue("site"), false)
}

// serveBackupFile streams a row's file. deletedOnly: the server owner's
// door, for networks that no longer exist (amendment 24).
func (s *Server) serveBackupFile(w http.ResponseWriter, r *http.Request, site string, deletedOnly bool) {
	ctx := r.Context()
	b, err := store.BackupByID(ctx, s.d.Store.R, r.PathValue("id"))
	if err != nil || (site != "" && b.SiteID != site) {
		writeError(w, http.StatusNotFound, ErrNotFound, nil)
		return
	}
	if deletedOnly {
		if _, err := store.SiteByID(ctx, s.d.Store.R, b.SiteID); err == nil {
			writeError(w, http.StatusNotFound, ErrNotFound, nil)
			return
		}
	}
	if s.d.Backups == nil {
		writeError(w, http.StatusConflict, ErrBackupOff, nil)
		return
	}
	d, cfg, err := s.d.Backups.OpenSaved(ctx)
	if err != nil {
		s.answer(w, "backup file", destFailure(err))
		return
	}
	if b.ConfigID != cfg.ConfigID {
		writeError(w, http.StatusGone, ErrGone, map[string]any{"previousDest": true})
		return
	}
	gctx, cancel := context.WithTimeout(ctx, 40*time.Second)
	defer cancel()
	body, err := backup.ReadFile(gctx, d, backup.FilePath(b), b.Ref)
	if err != nil {
		if backup.CodeOf(err) == backup.CodeNotFound {
			store.SetBackupFlags(ctx, s.d.Store.W, b.ID, true, b.DropPending)
			writeError(w, http.StatusNotFound, ErrNotFound, map[string]any{"missing": true})
			return
		}
		s.answer(w, "backup file", destFailure(err))
		return
	}
	h := w.Header()
	h.Set("Content-Type", "application/json")
	h.Set("Cache-Control", "no-store")
	h.Set("Content-Disposition", `attachment; filename="`+b.Name+`"`)
	h.Set("Content-Length", strconv.Itoa(len(body)))
	h.Set("X-Topo-Backup-Sha256", b.SHA256)
	w.WriteHeader(http.StatusOK)
	w.Write(body)
}

// siteReadableCopy: POST /api/sites/{site}/backups/readable {revN,
// fileName, file}: the readable copy an owner's browser made (D106). Only
// when the server owner allows readable copies and this network's owner
// turned them on; only of the head (a stale tab cannot overwrite a newer
// copy, amendment 25). Held in memory until the engine writes it.
func (s *Server) siteReadableCopy(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RevN     int64           `json:"revN"`
		FileName string          `json:"fileName"`
		File     json.RawMessage `json:"file"`
	}
	if err := decodeBody(w, r, s.d.Cfg.MaxRevBytes*4/3+64<<10, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	if !backup.ValidReadableName(req.FileName) || len(req.File) == 0 || req.File[0] != '{' {
		writeError(w, http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "file"})
		return
	}
	if int64(len(req.File)) > s.d.Cfg.MaxRevBytes {
		writeError(w, http.StatusRequestEntityTooLarge, ErrTooLarge, map[string]any{"max": s.d.Cfg.MaxRevBytes})
		return
	}
	ctx := r.Context()
	site := r.PathValue("site")
	cfg, err := store.GetBackupConfig(ctx, s.d.Store.R)
	if err != nil {
		s.internal(w, "readable", err)
		return
	}
	info, err := store.SiteForBackup(ctx, s.d.Store.R, site)
	if err != nil {
		s.answer(w, "readable", notFoundOr(err))
		return
	}
	if !cfg.Enabled || !cfg.ReadableAllowed || !info.Readable || s.d.Backups == nil {
		writeError(w, http.StatusConflict, ErrReadableOff, nil)
		return
	}
	if req.RevN != info.HeadN {
		writeError(w, http.StatusConflict, ErrStale, map[string]any{"head": info.HeadN})
		return
	}
	s.d.Backups.QueueReadable(site, req.RevN, req.FileName, append([]byte(nil), req.File...))
	writeJSON(w, http.StatusAccepted, map[string]any{"ok": true})
}

// siteDeleteReadable: DELETE /api/sites/{site}/backups/readable ("Delete
// readable copies", D106): every readable copy of the network is deleted at
// the destination and forgotten. Files on a previous destination are only
// forgotten (the server cannot reach them any more).
func (s *Server) siteDeleteReadable(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	site := r.PathValue("site")
	rows, err := store.SiteBackups(ctx, s.d.Store.R, site, "readable", "")
	if err != nil {
		s.internal(w, "readable", err)
		return
	}
	var d backup.Dest
	var cfg *store.BackupConfig
	if s.d.Backups != nil && len(rows) > 0 {
		if d, cfg, err = s.d.Backups.OpenSaved(ctx); err != nil {
			d, cfg = nil, nil
		}
	}
	dctx, cancel := context.WithTimeout(ctx, 40*time.Second)
	defer cancel()
	for _, b := range rows {
		if d != nil && cfg != nil && b.ConfigID == cfg.ConfigID {
			if err := d.Delete(dctx, backup.FilePath(&b), b.Ref); err != nil && backup.CodeOf(err) != backup.CodeNotFound {
				s.answer(w, "readable", destFailure(err))
				return
			}
		}
		if err := store.DeleteBackupRow(ctx, s.d.Store.W, b.ID); err != nil {
			s.internal(w, "readable", err)
			return
		}
	}
	noContent(w)
}

// adminDeletedBackups: GET /api/admin/backups/deleted/{sid}: the files of
// a network that no longer exists (amendment 24). The server owner sees
// only file names and ciphertext, which they hold anyway.
func (s *Server) adminDeletedBackups(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	site := r.PathValue("sid")
	if _, err := store.SiteByID(ctx, s.d.Store.R, site); err == nil {
		writeError(w, http.StatusNotFound, ErrNotFound, nil)
		return
	}
	list, err := s.backupList(ctx, site)
	if err != nil {
		s.internal(w, "backups", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"backups": list})
}

// adminDeletedBackupFile: GET /api/admin/backups/files/{id} (a deleted
// network's file).
func (s *Server) adminDeletedBackupFile(w http.ResponseWriter, r *http.Request) {
	s.serveBackupFile(w, r, "", true)
}

// adminDeleteDeletedBackups: DELETE /api/admin/backups/deleted/{sid}:
// deletes a deleted network's files at the destination and forgets them.
// Files on a previous destination are only forgotten.
func (s *Server) adminDeleteDeletedBackups(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	site := r.PathValue("sid")
	if _, err := store.SiteByID(ctx, s.d.Store.R, site); err == nil {
		writeError(w, http.StatusNotFound, ErrNotFound, nil)
		return
	}
	rows, err := store.SiteBackups(ctx, s.d.Store.R, site, "", "")
	if err != nil {
		s.internal(w, "backups", err)
		return
	}
	if len(rows) == 0 {
		writeError(w, http.StatusNotFound, ErrNotFound, nil)
		return
	}
	var d backup.Dest
	var cfg *store.BackupConfig
	if s.d.Backups != nil {
		d, cfg, _ = s.d.Backups.OpenSaved(ctx)
	}
	dctx, cancel := context.WithTimeout(ctx, 40*time.Second)
	defer cancel()
	for _, b := range rows {
		if d != nil && cfg != nil && b.ConfigID == cfg.ConfigID {
			if err := d.Delete(dctx, backup.FilePath(&b), b.Ref); err != nil && backup.CodeOf(err) != backup.CodeNotFound {
				s.answer(w, "backups", destFailure(err))
				return
			}
		}
		if err := store.DeleteBackupRow(ctx, s.d.Store.W, b.ID); err != nil {
			s.internal(w, "backups", err)
			return
		}
	}
	noContent(w)
}
