package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"carino.systems/topo/server/internal/auth"
	"carino.systems/topo/server/internal/mail"
	"carino.systems/topo/server/internal/store"
)

// welcomePerDay caps the welcome emails the server sends in 24 h (B8).
const welcomePerDay = 100

type adminUser struct {
	ID         string `json:"id"`
	Email      string `json:"email"`
	ServerRole string `json:"serverRole"`
	Lang       string `json:"lang"`
	Created    int64  `json:"created"`
	Disabled   bool   `json:"disabled"`
	Sites      int    `json:"sites"`
	HasKeys    bool   `json:"hasKeys"`
}

func (s *Server) adminUser(r *http.Request, q store.Q, id string) (*adminUser, error) {
	u, err := store.UserByID(r.Context(), q, id)
	if err != nil {
		return nil, err
	}
	a := &adminUser{ID: u.ID, Email: u.Email, ServerRole: u.ServerRole, Lang: u.Lang, Created: u.Created, Disabled: u.Disabled, HasKeys: u.EncPub != ""}
	err = q.QueryRowContext(r.Context(), "SELECT count(*) FROM members WHERE user_id = ?", id).Scan(&a.Sites)
	return a, err
}

// adminUsers: GET /api/admin/users.
func (s *Server) adminUsers(w http.ResponseWriter, r *http.Request) {
	rows, err := s.d.Store.R.QueryContext(r.Context(), `SELECT u.id, u.email, u.server_role, u.lang, u.created, u.disabled, u.enc_pub IS NOT NULL,
		(SELECT count(*) FROM members m WHERE m.user_id = u.id) FROM users u WHERE u.id NOT LIKE 'm\_%' ESCAPE '\' ORDER BY u.created, u.email`)
	if err != nil {
		s.internal(w, "admin users", err)
		return
	}
	defer rows.Close()
	out := []adminUser{}
	for rows.Next() {
		var a adminUser
		if err := rows.Scan(&a.ID, &a.Email, &a.ServerRole, &a.Lang, &a.Created, &a.Disabled, &a.HasKeys, &a.Sites); err != nil {
			s.internal(w, "admin users", err)
			return
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		s.internal(w, "admin users", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": out})
}

// adminAddUser: POST /api/admin/users {email, serverRole: staff|member,
// lang}. The person gets a welcome email and can then sign in.
func (s *Server) adminAddUser(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email      string `json:"email"`
		ServerRole string `json:"serverRole"`
		Lang       string `json:"lang"`
	}
	if err := decodeBody(w, r, 64<<10, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	norm, ok := auth.NormalizeEmail(req.Email)
	if !ok {
		writeError(w, http.StatusBadRequest, ErrBadEmail, nil)
		return
	}
	if req.ServerRole != "staff" && req.ServerRole != "member" {
		writeError(w, http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "serverRole"})
		return
	}
	if !mail.ValidLang(req.Lang) {
		req.Lang = "en"
	}
	sess := SessionFrom(r.Context())
	ctx := r.Context()
	ms := s.d.Now().UnixMilli()
	id := store.NewID("u_")
	var status int
	var code string
	var wait time.Duration
	err := s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := store.UserByEmail(ctx, tx, norm); err == nil {
			status, code = http.StatusConflict, ErrConflict
			return nil
		} else if !errors.Is(err, store.ErrNotFound) {
			return err
		}
		n, err := store.CountMail(ctx, tx, "welcome", "", "", ms-int64(24*time.Hour/time.Millisecond))
		if err != nil {
			return err
		}
		if n >= welcomePerDay {
			status, wait = http.StatusTooManyRequests, time.Hour
			return nil
		}
		if err := store.CreateUser(ctx, tx, &store.User{ID: id, Email: norm, EmailNorm: norm, Lang: req.Lang, ServerRole: req.ServerRole, Created: ms}); err != nil {
			return err
		}
		data, _ := json.Marshal(map[string]string{"inviter": sess.Email})
		return store.InsertMail(ctx, tx, &store.Mail{ID: store.NewID("o_"), Kind: "welcome", To: norm, UserID: id, Lang: req.Lang, Data: string(data), Created: ms, SendAfter: ms})
	})
	switch {
	case err != nil:
		s.internal(w, "admin add user", err)
		return
	case status == http.StatusTooManyRequests:
		rateLimited(w, wait)
		return
	case status != 0:
		writeError(w, status, code, nil)
		return
	}
	if s.d.Wake != nil {
		s.d.Wake()
	}
	a, err := s.adminUser(r, s.d.Store.R, id)
	if err != nil {
		s.internal(w, "admin add user", err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"user": a})
}

// adminPatchUser: PATCH /api/admin/users/{id} {serverRole?, disabled?}.
// The last enabled owner cannot be demoted or disabled, and neither can the
// TOPO_OWNER_EMAIL user (the next start would undo it). Disabling ends the
// user's sessions and open sign-in codes (B4).
func (s *Server) adminPatchUser(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ServerRole *string `json:"serverRole"`
		Disabled   *bool   `json:"disabled"`
	}
	if err := decodeBody(w, r, 64<<10, &req); err != nil {
		writeDecodeError(w, err)
		return
	}
	if req.ServerRole != nil {
		switch *req.ServerRole {
		case "owner", "staff", "member":
		default:
			writeError(w, http.StatusBadRequest, ErrBadRequest, map[string]any{"field": "serverRole"})
			return
		}
	}
	id := r.PathValue("id")
	ctx := r.Context()
	var status int
	var reason string
	var closed []string
	err := s.d.Store.Tx(ctx, func(tx *sql.Tx) error {
		u, err := store.UserByID(ctx, tx, id)
		if errors.Is(err, store.ErrNotFound) {
			status = http.StatusNotFound
			return nil
		}
		if err != nil {
			return err
		}
		demote := req.ServerRole != nil && *req.ServerRole != "owner" && u.ServerRole == "owner"
		disable := req.Disabled != nil && *req.Disabled && !u.Disabled
		if (demote || disable) && s.d.Cfg.OwnerEmail != "" && u.EmailNorm == s.d.Cfg.OwnerEmail {
			status, reason = http.StatusConflict, "owner-email"
			return nil
		}
		if (demote || disable) && u.ServerRole == "owner" && !u.Disabled {
			n, err := store.CountOwners(ctx, tx)
			if err != nil {
				return err
			}
			if n <= 1 {
				status, reason = http.StatusConflict, "last-owner"
				return nil
			}
		}
		if req.ServerRole != nil && *req.ServerRole != u.ServerRole {
			if err := store.SetServerRole(ctx, tx, u.ID, *req.ServerRole); err != nil {
				return err
			}
		}
		if req.Disabled != nil && *req.Disabled != u.Disabled {
			if _, err := tx.ExecContext(ctx, "UPDATE users SET disabled = ? WHERE id = ?", *req.Disabled, u.ID); err != nil {
				return err
			}
			if *req.Disabled {
				if closed, err = store.DeleteUserSessions(ctx, tx, u.ID, ""); err != nil {
					return err
				}
				if err := store.KillChallenges(ctx, tx, u.EmailNorm); err != nil {
					return err
				}
			}
		}
		return nil
	})
	switch {
	case err != nil:
		s.internal(w, "admin patch user", err)
		return
	case status == http.StatusNotFound:
		writeError(w, status, ErrNotFound, nil)
		return
	case status != 0:
		writeError(w, status, ErrConflict, map[string]any{"reason": reason})
		return
	}
	s.closeSessions(closed)
	a, err := s.adminUser(r, s.d.Store.R, id)
	if err != nil {
		s.internal(w, "admin patch user", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": a})
}
