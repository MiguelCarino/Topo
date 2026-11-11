package backup

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
)

// Destination secrets at rest (D105): the WebDAV password (5c: the S3
// secret, the OAuth client secret and refresh token) are sealed with
// AES-256-GCM under HKDF-SHA256(server.key, info "topo/backup-secrets"),
// with the kind and the destination's config id as additional data, and
// stored as backup_config.secret_ct. They are never sent to a browser.
//
// This protects a database that leaks alone (a copied topo.db, a database
// backup). It does not protect against someone who holds the data folder,
// where server.key sits beside topo.db (unless TOPO_SERVER_KEY puts it
// elsewhere), or who is root on the machine.

const secretsInfo = "topo/backup-secrets"

// ErrSecrets means the sealed secrets could not be opened: server.key
// changed, or the row was tampered with.
var ErrSecrets = &Error{Code: CodeSecrets, Err: errors.New("the saved passwords could not be read")}

func secretAEAD(serverKey []byte) (cipher.AEAD, error) {
	k, err := hkdf.Key(sha256.New, serverKey, nil, secretsInfo, 32)
	if err != nil {
		return nil, err
	}
	blk, err := aes.NewCipher(k)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(blk)
}

func secretAAD(kind, configID string) []byte {
	return []byte("topo-backup-secrets-v1\n" + kind + "\n" + configID)
}

// SealSecrets seals secrets ("" when there are none).
func SealSecrets(serverKey []byte, kind, configID string, secrets map[string]string) (string, error) {
	if len(secrets) == 0 {
		return "", nil
	}
	g, err := secretAEAD(serverKey)
	if err != nil {
		return "", err
	}
	pt, err := json.Marshal(secrets)
	if err != nil {
		return "", err
	}
	iv := make([]byte, 12)
	if _, err := rand.Read(iv); err != nil {
		return "", err
	}
	ct := g.Seal(nil, iv, pt, secretAAD(kind, configID))
	return "v1." + base64.RawURLEncoding.EncodeToString(iv) + "." + base64.RawURLEncoding.EncodeToString(ct), nil
}

// OpenSecrets opens what SealSecrets made ("" gives no secrets).
func OpenSecrets(serverKey []byte, kind, configID, sealed string) (map[string]string, error) {
	out := map[string]string{}
	if sealed == "" {
		return out, nil
	}
	var iv, ct []byte
	if len(sealed) > 3 && sealed[:3] == "v1." {
		rest := sealed[3:]
		for i := 0; i < len(rest); i++ {
			if rest[i] == '.' {
				var e1, e2 error
				iv, e1 = base64.RawURLEncoding.DecodeString(rest[:i])
				ct, e2 = base64.RawURLEncoding.DecodeString(rest[i+1:])
				if e1 != nil || e2 != nil {
					return nil, ErrSecrets
				}
				break
			}
		}
	}
	if len(iv) != 12 || len(ct) < 16 {
		return nil, ErrSecrets
	}
	g, err := secretAEAD(serverKey)
	if err != nil {
		return nil, ErrSecrets
	}
	pt, err := g.Open(nil, iv, ct, secretAAD(kind, configID))
	if err != nil {
		return nil, ErrSecrets
	}
	if err := json.Unmarshal(pt, &out); err != nil {
		return nil, ErrSecrets
	}
	return out, nil
}
