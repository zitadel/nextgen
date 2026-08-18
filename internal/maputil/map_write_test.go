package maputil_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/maputil"
)

func TestSetNested(t *testing.T) {
	t.Parallel()

	type write struct {
		path  []string
		value any
	}

	t.Run("ok", func(t *testing.T) {
		t.Parallel()

		tcs := []struct {
			name     string
			writes   []write
			expected map[string]any
		}{
			{
				name:     "leaf",
				writes:   []write{{path: []string{"name"}, value: "dummy"}},
				expected: map[string]any{"name": "dummy"},
			},
			{
				name:   "builds the intermediate maps",
				writes: []write{{path: []string{"address", "geo", "latitude"}, value: 45.0}},
				expected: map[string]any{
					"address": map[string]any{
						"geo": map[string]any{"latitude": 45.0},
					},
				},
			},
			{
				name: "merges into a map an earlier write created",
				writes: []write{
					{path: []string{"address", "street"}, value: "main street"},
					{path: []string{"address", "city"}, value: "examplus"},
				},
				expected: map[string]any{
					"address": map[string]any{
						"street": "main street",
						"city":   "examplus",
					},
				},
			},
			{
				// The caller owns the separator, so a segment that contains a
				// dot addresses one key rather than two levels.
				name:     "a dot inside a segment is part of the key",
				writes:   []write{{path: []string{"address.street"}, value: "main street"}},
				expected: map[string]any{"address.street": "main street"},
			},
		}

		for _, tc := range tcs {
			t.Run(tc.name, func(t *testing.T) {
				t.Parallel()

				m := map[string]any{}
				for _, w := range tc.writes {
					require.NoError(t, maputil.SetNested(m, w.path, w.value))
				}
				assert.Equal(t, tc.expected, m)
			})
		}
	})

	t.Run("descends through a value that is not a map", func(t *testing.T) {
		t.Parallel()

		// There is nowhere to write without discarding the existing value.
		m := map[string]any{}
		require.NoError(t, maputil.SetNested(m, []string{"address"}, "main street"))

		err := maputil.SetNested(m, []string{"address", "city"}, "examplus")
		require.Error(t, err)
		assert.ErrorContains(t, err, "address")
		assert.Equal(t, map[string]any{"address": "main street"}, m, "the existing value survives")
	})

	t.Run("empty path", func(t *testing.T) {
		t.Parallel()

		m := map[string]any{}
		require.Error(t, maputil.SetNested(m, nil, "dummy"))
		assert.Empty(t, m)
	})

	// SetNested writes what GetNested reads.
	t.Run("round-trips with GetNested", func(t *testing.T) {
		t.Parallel()

		path := []string{"address", "geo", "label"}
		m := map[string]any{}
		require.NoError(t, maputil.SetNested(m, path, "downtown"))

		got, ok := maputil.GetNested[string](m, path)
		require.True(t, ok)
		assert.Equal(t, "downtown", got)
	})
}
