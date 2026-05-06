package idgen

import (
	"crypto/rand"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestULID_New(t *testing.T) {
	t.Run("empty prefix returns error", func(t *testing.T) {
		g := NewULID()
		id, err := g.New("")
		require.Error(t, err)
		assert.Empty(t, id)
	})

	t.Run("trailing underscore is stripped", func(t *testing.T) {
		g := NewULID()
		id, err := g.New("att_")
		require.NoError(t, err)
		assert.True(t, strings.HasPrefix(id, "att_"), "expected prefix att_, got %s", id)
		assert.False(t, strings.HasPrefix(id, "att__"), "expected no double underscore, got %s", id)
	})

	t.Run("returns correct prefix format", func(t *testing.T) {
		g := NewULID()
		id, err := g.New("att")
		require.NoError(t, err)
		assert.True(t, strings.HasPrefix(id, "att_"), "expected prefix att_, got %s", id)
	})

	t.Run("IDs are unique", func(t *testing.T) {
		g := NewULID()
		id1, err := g.New("att")
		require.NoError(t, err)
		id2, err := g.New("att")
		require.NoError(t, err)
		assert.NotEqual(t, id1, id2)
	})

	t.Run("IDs are time-sortable", func(t *testing.T) {
		now := time.Now()
		tick := 0
		g := &ULID{
			entropy: ulid.Monotonic(rand.Reader, 0),
			now: func() time.Time {
				// advance by 1ms per call to guarantee ordering
				t := now.Add(time.Duration(tick) * time.Millisecond)
				tick++
				return t
			},
		}
		const n = 100
		ids := make([]string, n)
		for i := range ids {
			id, err := g.New("att")
			require.NoError(t, err)
			ids[i] = id
		}
		for i := 1; i < n; i++ {
			assert.Greater(t, ids[i], ids[i-1], "IDs should be lexicographically increasing")
		}
	})

	t.Run("safe for concurrent use", func(t *testing.T) {
		g := NewULID()
		const goroutines = 50
		results := make([]string, goroutines)
		var wg sync.WaitGroup
		wg.Add(goroutines)
		for i := range goroutines {
			go func(i int) {
				defer wg.Done()
				id, err := g.New("att")
				require.NoError(t, err)
				results[i] = id
			}(i)
		}
		wg.Wait()
		seen := make(map[string]struct{}, goroutines)
		for _, id := range results {
			assert.NotEmpty(t, id)
			_, duplicate := seen[id]
			assert.False(t, duplicate, "duplicate ID: %s", id)
			seen[id] = struct{}{}
		}
	})
}
