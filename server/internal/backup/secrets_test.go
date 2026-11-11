package backup

import (
	"bytes"
	"strings"
	"testing"
)

func TestSecretsRoundTrip(t *testing.T) {
	key := bytes.Repeat([]byte{7}, 32)
	sealed, err := SealSecrets(key, "webdav", "bc_1", map[string]string{"password": "s3cret pass"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(sealed, "s3cret") {
		t.Fatal("not sealed")
	}
	got, err := OpenSecrets(key, "webdav", "bc_1", sealed)
	if err != nil || got["password"] != "s3cret pass" {
		t.Fatalf("%v %v", got, err)
	}
	// A different server.key, kind or destination cannot open it.
	if _, err := OpenSecrets(bytes.Repeat([]byte{8}, 32), "webdav", "bc_1", sealed); CodeOf(err) != CodeSecrets {
		t.Fatalf("other key: %v", err)
	}
	if _, err := OpenSecrets(key, "s3", "bc_1", sealed); CodeOf(err) != CodeSecrets {
		t.Fatal("the kind is not bound")
	}
	if _, err := OpenSecrets(key, "webdav", "bc_2", sealed); CodeOf(err) != CodeSecrets {
		t.Fatal("the config id is not bound")
	}
	for _, junk := range []string{"x", "v1.", "v1.AAAA.BBBB", "v2." + sealed[3:]} {
		if _, err := OpenSecrets(key, "webdav", "bc_1", junk); CodeOf(err) != CodeSecrets {
			t.Errorf("%q opened", junk)
		}
	}
	// Two seals of the same secret differ (random iv).
	again, _ := SealSecrets(key, "webdav", "bc_1", map[string]string{"password": "s3cret pass"})
	if again == sealed {
		t.Fatal("same ciphertext twice")
	}
	if s, _ := SealSecrets(key, "folder", "bc_1", nil); s != "" {
		t.Fatal("no secrets seal to empty")
	}
}
