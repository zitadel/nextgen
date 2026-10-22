package idgen_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/storage/dialect/idgen"
)

func TestEnsure(t *testing.T) {
	t.Parallel()
	g := idgen.NewULID()

	t.Run("assigns when empty", func(t *testing.T) {
		t.Parallel()
		var id string
		require.NoError(t, idgen.Ensure(&id, "user", g))
		require.Regexp(t, `^user_[0-9A-HJKMNP-TV-Z]{26}$`, id)
	})

	t.Run("preserves non-empty", func(t *testing.T) {
		t.Parallel()
		id := "https://example.com/schemas/human.json"
		require.NoError(t, idgen.Ensure(&id, "sch", g))
		require.Equal(t, "https://example.com/schemas/human.json", id)
	})

	t.Run("nil pointer", func(t *testing.T) {
		t.Parallel()
		err := idgen.Ensure(nil, "user", g)
		require.Error(t, err)
	})

	t.Run("empty prefix when minting", func(t *testing.T) {
		t.Parallel()
		id := ""
		err := idgen.Ensure(&id, "", g)
		require.Error(t, err)
	})
}
