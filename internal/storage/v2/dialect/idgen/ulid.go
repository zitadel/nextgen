package idgen

import (
	"crypto/rand"
	"sync"
	"time"

	"github.com/oklog/ulid/v2"
)

// ULID produces time-sortable, prefixed IDs (Postgres). Concurrent-safe.
type ULID struct {
	mu      sync.Mutex
	entropy *ulid.MonotonicEntropy
	now     func() time.Time
}

// NewULID returns a [ULID] generator using crypto/rand entropy.
func NewULID() *ULID {
	return &ULID{
		entropy: ulid.Monotonic(rand.Reader, 0),
		now:     time.Now,
	}
}

// New implements [Generator].
func (g *ULID) New(prefix string) (string, error) {
	prefix, err := normalizePrefix(prefix)
	if err != nil {
		return "", err
	}

	g.mu.Lock()
	defer g.mu.Unlock()

	id, err := ulid.New(ulid.Timestamp(g.now()), g.entropy)
	if err != nil {
		return "", err
	}
	return prefix + "_" + id.String(), nil
}
