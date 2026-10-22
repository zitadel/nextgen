package idgen_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/storage/dialect/idgen"
)

func TestUUID_New(t *testing.T) {
	t.Parallel()
	g := idgen.NewUUID()

	t.Run("prefix and uuid body", func(t *testing.T) {
		t.Parallel()
		id, err := g.New("user")
		require.NoError(t, err)
		require.True(t, strings.HasPrefix(id, "user_"))
		body := strings.TrimPrefix(id, "user_")
		require.Regexp(t, `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`, body)
	})

	t.Run("strips trailing underscore", func(t *testing.T) {
		t.Parallel()
		id, err := g.New("user_")
		require.NoError(t, err)
		require.True(t, strings.HasPrefix(id, "user_"))
		require.False(t, strings.HasPrefix(id, "user__"))
	})

	t.Run("empty prefix", func(t *testing.T) {
		t.Parallel()
		_, err := g.New("")
		require.Error(t, err)
	})
}
