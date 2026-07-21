package repository

import (
	"testing"

	googspanner "cloud.google.com/go/spanner"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEncodeSpannerJSON(t *testing.T) {
	t.Parallel()

	t.Run("object", func(t *testing.T) {
		t.Parallel()
		got, ok := encodeSpannerJSON([]byte(`{"type":"object"}`)).(googspanner.NullJSON)
		require.True(t, ok)
		assert.True(t, got.Valid)
		assert.Equal(t, map[string]any{"type": "object"}, got.Value)
	})

	t.Run("empty", func(t *testing.T) {
		t.Parallel()
		got, ok := encodeSpannerJSON(nil).(googspanner.NullJSON)
		require.True(t, ok)
		assert.False(t, got.Valid)
	})

	t.Run("invalid_falls_back_to_string_value", func(t *testing.T) {
		t.Parallel()
		got, ok := encodeSpannerJSON([]byte(`not-json`)).(googspanner.NullJSON)
		require.True(t, ok)
		assert.True(t, got.Valid)
		assert.Equal(t, "not-json", got.Value)
	})
}
