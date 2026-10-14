package harness

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"testing"
)

func TestManifestRoundTripIsPrivate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "out", "manifest.json")
	in := Manifest{
		Target:   Target{Base: "http://x", ProjectSecret: "s3cret", ProjectID: "proj_1"},
		Project:  ManifestProject{ID: "proj_1", Name: "bench-a"},
		Users:    []ManifestUser{{ID: "user_1", Email: "bench@bench.local", Primary: true}},
		Sessions: []string{"sess_1"},
	}
	if err := SaveManifest(path, in); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("manifest holds the project secret but is mode %o", info.Mode().Perm())
	}
	out, err := LoadManifest(path)
	if err != nil {
		t.Fatal(err)
	}
	if out.Version != ManifestVersion || out.Project != in.Project || out.Target != in.Target ||
		len(out.Users) != 1 || out.Users[0] != in.Users[0] || len(out.Sessions) != 1 || out.CreatedAt.IsZero() {
		t.Errorf("round trip lost data: %+v", out)
	}
	if entries, _ := os.ReadDir(filepath.Dir(path)); len(entries) != 1 {
		t.Errorf("temporary files left behind: %v", entries)
	}
}

func TestLoadManifestMissingAndVersion(t *testing.T) {
	dir := t.TempDir()
	if _, err := LoadManifest(filepath.Join(dir, "none.json")); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("missing manifest = %v, want fs.ErrNotExist", err)
	}
	if m, err := LoadManifestIfPresent(filepath.Join(dir, "none.json")); m != nil || err != nil {
		t.Errorf("LoadManifestIfPresent on missing = %v, %v", m, err)
	}
	path := filepath.Join(dir, "old.json")
	if err := osWriteFile(path, `{"version":99}`); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadManifest(path); err == nil {
		t.Error("a manifest of another version was accepted")
	}
}
