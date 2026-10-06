package domain

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseReleaseRef(t *testing.T) {
	t.Run("id", func(t *testing.T) {
		ref, err := ParseReleaseRef(" rel_01KX3RG8A7F0N9WD3P2E4YM5C1 ")
		require.NoError(t, err)
		assert.Equal(t, ReleaseRef{ID: "rel_01KX3RG8A7F0N9WD3P2E4YM5C1"}, ref)
	})

	t.Run("prefixed digest", func(t *testing.T) {
		ref, err := ParseReleaseRef("sha256:9F2C1A7B4E83d05f")
		require.NoError(t, err)
		assert.Equal(t, ReleaseRef{HashPrefix: "9f2c1a7b4e83d05f"}, ref)
	})

	t.Run("bare digest", func(t *testing.T) {
		full := strings.Repeat("ab", 32)
		ref, err := ParseReleaseRef(full)
		require.NoError(t, err)
		assert.Equal(t, ReleaseRef{HashPrefix: full}, ref)
	})

	t.Run("too short, too long, not hex", func(t *testing.T) {
		for _, bad := range []string{"9f2c1a7b4e8", strings.Repeat("a", 65), "sha256:xyzxyzxyzxyzxyz", "", "dep_1"} {
			_, err := ParseReleaseRef(bad)
			assert.Error(t, err, bad)
		}
	})
}
