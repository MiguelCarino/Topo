// Package backup writes encrypted backups of every network to one
// destination the server owner chose (docs/SCOPE.md step 5b, D99-D105): a
// folder on the server or WebDAV in 5b; S3, Google Drive and OneDrive in 5c.
//
// A backup file is the network's head revision exactly as the server holds
// it (ciphertext), plus what an owner needs to open it (snapshot.go). The
// engine (engine.go) writes after a quiet spell following each push, once a
// day for networks that changed, keeps 24 h + 7 daily + 4 weekly + 12
// monthly (retention.go), and reads the newest back weekly (check.go).
package backup

import (
	"context"
	"errors"
	"fmt"
	"io"
	"time"
)

// MaxFile is the largest file a destination takes.
const MaxFile = 64 << 20

// OpTimeout bounds one destination operation (amendment 8).
const OpTimeout = 2 * time.Minute

// Entry is one file in a destination folder.
type Entry struct {
	Name string // the file name, no folder
	Size int64
	Mod  time.Time
	Ref  string // 5c: the Drive / OneDrive item id
}

// Dest is a place backups go. Names are relative and use "/": "<site>/<file>"
// or "<site>/readable/<file>".
type Dest interface {
	Kind() string
	// Put writes body at name (making folders as needed) and returns the
	// item reference (empty when names are enough).
	Put(ctx context.Context, name string, body []byte) (ref string, err error)
	Get(ctx context.Context, name, ref string) (io.ReadCloser, error)
	// List lists the files directly in dir ("" lists nothing useful: the
	// top holds one folder per network). A missing dir is an empty list.
	List(ctx context.Context, dir string) ([]Entry, error)
	Delete(ctx context.Context, name, ref string) error
	// Check writes a probe file, reads it back, compares and deletes it.
	Check(ctx context.Context) error
}

// Error codes: what goes in the status and the failure mail. Never a URL, a
// file name or a response body (A2).
const (
	CodeUnreachable = "unreachable" // network error, timeout, 5xx
	CodeRefused     = "refused"     // 401, 403
	CodeNotFound    = "not-found"   // 404, a folder that is not there (no disk)
	CodeFull        = "full"        // 507, ENOSPC
	CodeTooLarge    = "too-large"   // over MaxFile, 413
	CodeConflict    = "conflict"    // 409 elsewhere, 412, 423
	CodeBadAnswer   = "bad-answer"  // a redirect, an answer that makes no sense
	CodeCertificate = "certificate" // TLS verification failed
	CodeSecrets     = "secrets"     // saved passwords could not be opened
	CodeMismatch    = "mismatch"    // check: the file read back is not what was written
	CodeDamaged     = "damaged"     // check: the file does not verify
	CodeOther       = "other"
	// 5c (D110, D111):
	CodeConnect      = "connect"       // the drive's sign-in ended (invalid_grant) or never happened: Connect again
	CodeClientSecret = "client-secret" // the app's client id or secret is refused (an expired Microsoft secret)
	CodeClock        = "clock"         // S3 RequestTimeTooSkewed: this server's clock is wrong
	// CodeLocked is a delete the store refused because it keeps files locked
	// (S3 object lock). Not a failure of the run, so not in Codes: it is a
	// note in the status (amendment 16).
	CodeLocked = "locked"
)

// Codes lists every code (the mail locales have a sentence for each).
var Codes = []string{CodeUnreachable, CodeRefused, CodeNotFound, CodeFull, CodeTooLarge, CodeConflict, CodeBadAnswer, CodeCertificate, CodeSecrets, CodeMismatch, CodeDamaged, CodeConnect, CodeClientSecret, CodeClock, CodeOther}

// Error is a destination failure with its code. Err is for the log only.
type Error struct {
	Code string
	Err  error
	// Fingerprint is the certificate the far end presented (CodeCertificate),
	// so the owner can compare it and paste it (amendment 15).
	Fingerprint string
}

func (e *Error) Error() string {
	if e.Err != nil {
		return e.Code + ": " + e.Err.Error()
	}
	return e.Code
}

func (e *Error) Unwrap() error { return e.Err }

func errf(code, format string, a ...any) error {
	return &Error{Code: code, Err: fmt.Errorf(format, a...)}
}

// CodeOf is the code of err (CodeOther for anything that is not an *Error;
// CodeUnreachable for a deadline).
func CodeOf(err error) string {
	if err == nil {
		return ""
	}
	var e *Error
	if errors.As(err, &e) {
		return e.Code
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return CodeUnreachable
	}
	return CodeOther
}

// stops reports whether a code means the destination as a whole is not
// usable now, so a run stops and backs off instead of trying every network
// (amendment 8).
func stops(code string) bool {
	switch code {
	case CodeUnreachable, CodeRefused, CodeFull, CodeNotFound, CodeCertificate, CodeSecrets, CodeConnect, CodeClientSecret, CodeClock:
		return true
	}
	return false
}
