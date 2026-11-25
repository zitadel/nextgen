package jobs

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestBackoffFor(t *testing.T) {
	t.Parallel()
	cap := time.Hour
	assert.Equal(t, time.Second, backoffFor(0, cap))
	assert.Equal(t, 2*time.Second, backoffFor(1, cap))
	assert.Equal(t, 4*time.Second, backoffFor(2, cap))
	assert.Equal(t, cap, backoffFor(20, cap))
	assert.Equal(t, 500*time.Millisecond, backoffFor(0, 500*time.Millisecond))
}
