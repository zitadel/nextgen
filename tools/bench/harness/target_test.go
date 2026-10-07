package harness

import (
	"os"
	"path/filepath"
	"testing"
)

// TestSaveTargetTightensExistingFile: the state file holds the project
// secret, so an existing world-readable file is tightened to 0600 rather
// than kept as os.WriteFile would.
func TestSaveTargetTightensExistingFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "target.json")
	if err := os.WriteFile(path, []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := SaveTarget(path, Target{Base: "http://x", ProjectSecret: "s3cret"}); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Errorf("mode = %o, want 600", mode)
	}
	got, err := LoadTarget(path)
	if err != nil || got.ProjectSecret != "s3cret" {
		t.Errorf("round trip = %+v, %v", got, err)
	}
}

// TestTargetEnvRoundTrip: what the sweep puts in the child environment is
// what the module reads back.
func TestTargetEnvRoundTrip(t *testing.T) {
	want := Target{Base: "http://b", Lane: "l", ProjectID: "p", ProjectSecret: "s", Origin: "o", UserID: "u", Email: "e", Password: "pw"}
	env := map[string]string{}
	for _, kv := range want.Env() {
		k, v, _ := cutEnv(kv)
		env[k] = v
	}
	got, err := TargetFromEnv(func(k string) (string, bool) { v, ok := env[k]; return v, ok })
	if err != nil || got != want {
		t.Errorf("got %+v, %v; want %+v", got, err, want)
	}
}

func cutEnv(kv string) (string, string, bool) {
	for i := range len(kv) {
		if kv[i] == '=' {
			return kv[:i], kv[i+1:], true
		}
	}
	return kv, "", false
}
