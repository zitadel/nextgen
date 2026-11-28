package cache

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The library reads a zero size as unbounded and a zero ttl as never
// expiring, so neither is accepted.
func TestNewMeteredExpirableLRURefusesZero(t *testing.T) {
	_, err := NewMeteredExpirableLRU[string, int]("test", 0, time.Minute)
	assert.Error(t, err)
	_, err = NewMeteredExpirableLRU[string, int]("test", 1, 0)
	assert.Error(t, err)
}

func TestMeteredExpirableLRUExpires(t *testing.T) {
	c, err := NewMeteredExpirableLRU[string, int]("test", 1, 20*time.Millisecond)
	require.NoError(t, err)
	c.Add("a", 1)
	got, ok := c.Get("a")
	require.True(t, ok)
	assert.Equal(t, 1, got)
	assert.Eventually(t, func() bool {
		_, ok := c.Get("a")
		return !ok
	}, time.Second, 5*time.Millisecond)
}
