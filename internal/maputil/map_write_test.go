package maputil_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/maputil"
)

func TestSetNested(t *testing.T) {
	t.Parallel()

	t.Run("ok", func(t *testing.T) {
		t.Parallel()

		tcs := []struct {
			name     string
			writes   map[string]any
			expected map[string]any
		}{
			{
				name:     "leaf",
				writes:   map[string]any{"name": "dummy"},
				expected: map[string]any{"name": "dummy"},
			},
			{
				name:   "builds the intermediate maps",
				writes: map[string]any{"address.geo.latitude": 45.0},
				expected: map[string]any{
					"address": map[string]any{
						"geo": map[string]any{"latitude": 45.0},
					},
				},
			},
			{
				name: "merges into a map an earlier write created",
				writes: map[string]any{
					"address.street": "main street",
					"address.city":   "examplus",
				},
				expected: map[string]any{
					"address": map[string]any{
						"street": "main street",
						"city":   "examplus",
					},
				},
			},
		}

		for _, tc := range tcs {
			t.Run(tc.name, func(t *testing.T) {
				t.Parallel()

				m := map[string]any{}
				for path, value := range tc.writes {
					require.NoError(t, maputil.SetNested(m, path, value))
				}
				assert.Equal(t, tc.expected, m)
			})
		}
	})

	t.Run("error", func(t *testing.T) {
		t.Parallel()

		// The path descends through a value that is not a map, so there is
		// nowhere to write without discarding it.
		m := map[string]any{}
		require.NoError(t, maputil.SetNested(m, "address", "main street"))

		err := maputil.SetNested(m, "address.city", "examplus")
		require.Error(t, err)
		assert.ErrorContains(t, err, "address")
		assert.Equal(t, map[string]any{"address": "main street"}, m, "the existing value survives")
	})

	// SetNested writes what GetNested reads.
	t.Run("round-trips with GetNested", func(t *testing.T) {
		t.Parallel()

		m := map[string]any{}
		require.NoError(t, maputil.SetNested(m, "address.geo.label", "downtown"))

		got, ok := maputil.GetNested[string](m, "address.geo.label")
		require.True(t, ok)
		assert.Equal(t, "downtown", got)
	})
}
