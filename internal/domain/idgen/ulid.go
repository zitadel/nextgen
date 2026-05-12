package idgen

import (
	"crypto/rand"
	"fmt"
	"sync"
	"time"

	"github.com/oklog/ulid/v2"
)

// ULID is a [Generator] that produces time-sortable, prefixed IDs using the ULID spec.
// Within the same millisecond, IDs are guaranteed to be monotonically increasing.
// ULID is safe for concurrent use.
type ULID struct {
	mu sync.Mutex
	// entropy is a monotonic entropy source that ensures IDs generated within
	// the same millisecond are still lexicographically ordered by creation order.
	entropy *ulid.MonotonicEntropy
	// now is the time source used for the ULID timestamp component.
	// It is injectable to allow deterministic testing.
	now func() time.Time
}

// NewULID returns a new [ULID] generator using crypto/rand as the entropy source.
func NewULID() *ULID {
	return &ULID{
		entropy: ulid.Monotonic(rand.Reader, 0),
		now:     time.Now,
	}
}

// New implements [Generator]. It returns a new ID in the form "<prefix>_<ulid>",
// for example "att_01J0Z9KX7Y0Q2Y7JX5M9K2YF3C".
// A trailing underscore on prefix is stripped automatically.
func (g *ULID) New(prefix string) (string, error) {
	if prefix == "" {
		return "", fmt.Errorf("idgen: prefix must not be empty")
	}
	// Be lenient: strip a trailing underscore so callers using e.g. "att_" and
	// "att" both produce the same canonical form "att_<ulid>".
	if prefix[len(prefix)-1] == '_' {
		prefix = prefix[:len(prefix)-1]
	}

	// Serialize access to the monotonic entropy source; it is not safe for
	// concurrent use as it holds an internal counter to guarantee ordering
	// within the same millisecond.
	g.mu.Lock()
	defer g.mu.Unlock()

	id, err := ulid.New(ulid.Timestamp(g.now()), g.entropy)
	if err != nil {
		return "", err
	}
	return prefix + "_" + id.String(), nil
}
