package harness

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"time"
)

// ManifestVersion is bumped when the file's shape changes incompatibly.
const ManifestVersion = 1

// Manifest records everything `bootstrap` created on a target. It is the one
// file `clean`, `doctor` and every scenario read, so no scenario invents its
// own identifiers and `clean` knows exactly what is ours to remove. It holds
// the project secret, so it is written owner-readable only.
type Manifest struct {
	Version   int       `json:"version"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	// Target is what the scenarios run against: the base URL, the project and
	// its secret, and the primary user whose credentials the login scenario
	// uses.
	Target Target `json:"target"`

	Project ManifestProject `json:"project"`
	// Users lists every user bootstrap created, the primary user first.
	Users []ManifestUser `json:"users"`
	// Sessions lists the sessions bootstrap's proof login opened.
	Sessions []string `json:"sessions"`
}

// ManifestProject is the project bootstrap created. It stays in the manifest
// after `clean`: the API has no delete-project operation, so the next
// bootstrap reuses it instead of leaking a second one.
type ManifestProject struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// ManifestUser is a user bootstrap created.
type ManifestUser struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	// Primary marks the user the scenarios log in as.
	Primary bool `json:"primary,omitzero"`
}

// LoadManifest reads a manifest. A missing file is reported as an error
// satisfying errors.Is(err, fs.ErrNotExist) so callers can tell "nothing
// provisioned yet" from a damaged file.
func LoadManifest(path string) (Manifest, error) {
	var m Manifest
	b, err := os.ReadFile(path)
	if err != nil {
		return m, err
	}
	if err := json.Unmarshal(b, &m); err != nil {
		return m, fmt.Errorf("%s: %w", path, err)
	}
	if m.Version != ManifestVersion {
		return m, fmt.Errorf("%s: manifest version %d, this harness reads version %d", path, m.Version, ManifestVersion)
	}
	return m, nil
}

// LoadManifestIfPresent returns nil when path does not exist.
func LoadManifestIfPresent(path string) (*Manifest, error) {
	m, err := LoadManifest(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &m, nil
}

// SaveManifest writes the manifest atomically: a crash between bootstrap's
// phases leaves the previous complete file, never a torn one.
func SaveManifest(path string, m Manifest) error {
	m.Version = ManifestVersion
	m.UpdatedAt = time.Now().UTC()
	if m.CreatedAt.IsZero() {
		m.CreatedAt = m.UpdatedAt
	}
	b, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.Write(append(b, '\n')); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), path)
}

// LoadTarget reads the target out of a manifest.
func LoadTarget(path string) (Target, error) {
	m, err := LoadManifest(path)
	return m.Target, err
}

// userByEmail finds a manifest user by address.
func (m *Manifest) userByEmail(email string) (int, bool) {
	for i, u := range m.Users {
		if u.Email == email {
			return i, true
		}
	}
	return 0, false
}
