package harness

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"syscall"
	"time"
)

// RunLock marks a target as in use by this harness: a sweep holds it for its
// whole duration and bootstrap holds it while it provisions, so `clean`
// cannot delete the fixtures a run is measuring. It is a file next to the
// manifest, holding the owner's pid; a lock whose process is gone is stale
// and is taken over rather than blocking forever.
type RunLock struct {
	path string
}

type lockInfo struct {
	PID     int       `json:"pid"`
	Command string    `json:"command"`
	Since   time.Time `json:"since"`
}

// LockPath is where the lock for the manifest at manifestPath lives.
func LockPath(manifestPath string) string { return manifestPath + ".lock" }

// ErrRunInFlight is returned when another live process holds the lock.
var ErrRunInFlight = errors.New("a run is in flight")

// AcquireRunLock takes the lock for command, failing with ErrRunInFlight
// when a live process already holds it.
func AcquireRunLock(manifestPath, command string) (*RunLock, error) {
	path := LockPath(manifestPath)
	body, err := json.Marshal(lockInfo{PID: os.Getpid(), Command: command, Since: time.Now().UTC()})
	if err != nil {
		return nil, err
	}
	for range 2 {
		f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if err == nil {
			_, werr := f.Write(body)
			cerr := f.Close()
			if err := errors.Join(werr, cerr); err != nil {
				_ = os.Remove(path)
				return nil, err
			}
			return &RunLock{path: path}, nil
		}
		if !errors.Is(err, fs.ErrExist) {
			return nil, err
		}
		holder, live := lockHolder(path)
		if live {
			return nil, fmt.Errorf("%w: `%s` (pid %d) has held %s since %s",
				ErrRunInFlight, holder.Command, holder.PID, path, holder.Since.Format(time.RFC3339))
		}
		// Stale: its owner died without releasing it.
		if err := os.Remove(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return nil, err
		}
	}
	return nil, fmt.Errorf("could not take %s", path)
}

// CheckNoRun returns ErrRunInFlight when a live process holds the lock for
// manifestPath, without taking it. `clean` uses it for the dry run, which
// changes nothing and so does not need to exclude anyone.
func CheckNoRun(manifestPath string) error {
	path := LockPath(manifestPath)
	holder, live := lockHolder(path)
	if live {
		return fmt.Errorf("%w: `%s` (pid %d) has held %s since %s",
			ErrRunInFlight, holder.Command, holder.PID, path, holder.Since.Format(time.RFC3339))
	}
	return nil
}

// Release removes the lock.
func (l *RunLock) Release() error {
	if l == nil {
		return nil
	}
	if err := os.Remove(l.path); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
}

// lockHolder reads the lock file. live is true only when the file names a
// process that still exists; an unreadable or absent file counts as no
// holder, because a lock that cannot be read cannot be honoured.
func lockHolder(path string) (info lockInfo, live bool) {
	b, err := os.ReadFile(path)
	if err != nil {
		return info, false
	}
	if err := json.Unmarshal(b, &info); err != nil || info.PID <= 0 {
		return info, false
	}
	return info, processAlive(info.PID)
}

func processAlive(pid int) bool {
	err := syscall.Kill(pid, 0)
	// EPERM means the process exists but belongs to someone else.
	return err == nil || errors.Is(err, syscall.EPERM)
}
