package deployment

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

// A clock behind notBefore still stamps at notBefore.
func TestStamp(t *testing.T) {
	t0 := time.Date(2026, 10, 2, 14, 52, 0, 0, time.UTC)
	notBefore := t0.Add(time.Microsecond)

	assert.Equal(t, notBefore, Stamp(t0.Add(-time.Hour), &notBefore))
	assert.Equal(t, t0.Add(time.Minute), Stamp(t0.Add(time.Minute+time.Nanosecond), &notBefore))
	assert.Equal(t, t0, Stamp(t0, nil))
}
