package harness

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func osWriteFile(path, body string) error { return os.WriteFile(path, []byte(body), 0o644) }

func TestRunLockExcludesAndReleases(t *testing.T) {
	manifest := filepath.Join(t.TempDir(), "manifest.json")

	if err := CheckNoRun(manifest); err != nil {
		t.Fatalf("no lock yet, got %v", err)
	}
	lock, err := AcquireRunLock(manifest, "sweep")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := AcquireRunLock(manifest, "bootstrap"); !errors.Is(err, ErrRunInFlight) {
		t.Errorf("second acquire = %v, want ErrRunInFlight", err)
	}
	if err := CheckNoRun(manifest); !errors.Is(err, ErrRunInFlight) {
		t.Errorf("CheckNoRun while held = %v, want ErrRunInFlight", err)
	}
	if err := lock.Release(); err != nil {
		t.Fatal(err)
	}
	if err := CheckNoRun(manifest); err != nil {
		t.Errorf("after release, got %v", err)
	}
	if err := lock.Release(); err != nil {
		t.Errorf("releasing twice: %v", err)
	}
}

// TestRunLockTakesOverStale: a lock whose process is gone must not block the
// target forever.
func TestRunLockTakesOverStale(t *testing.T) {
	manifest := filepath.Join(t.TempDir(), "manifest.json")
	if err := osWriteFile(LockPath(manifest), `{"pid":2147483646,"command":"sweep","since":"2026-01-01T00:00:00Z"}`); err != nil {
		t.Fatal(err)
	}
	if err := CheckNoRun(manifest); err != nil {
		t.Errorf("stale lock reported as in flight: %v", err)
	}
	lock, err := AcquireRunLock(manifest, "clean")
	if err != nil {
		t.Fatalf("stale lock not taken over: %v", err)
	}
	_ = lock.Release()
}

// TestRunLockUnreadableIsNotAHolder: a garbled lock names no process, so it
// cannot be honoured and is replaced.
func TestRunLockUnreadableIsNotAHolder(t *testing.T) {
	manifest := filepath.Join(t.TempDir(), "manifest.json")
	if err := osWriteFile(LockPath(manifest), `not json`); err != nil {
		t.Fatal(err)
	}
	lock, err := AcquireRunLock(manifest, "clean")
	if err != nil {
		t.Fatal(err)
	}
	_ = lock.Release()
}
