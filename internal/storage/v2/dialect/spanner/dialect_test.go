package spanner

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func TestDecodeConfig(t *testing.T) {
	t.Parallel()

	t.Run("valid DSN string", func(t *testing.T) {
		t.Parallel()

		dialect, err := DecodeConfig("projects/p/instances/i/databases/d")
		require.NoError(t, err)
		assert.Equal(t, "spanner", dialect.Name())

		require.IsType(t, &Dialect{}, dialect)
		spannerDialect := dialect.(*Dialect)
		assert.Equal(t, "projects/p/instances/i/databases/d", spannerDialect.Database)
	})

	t.Run("invalid input type", func(t *testing.T) {
		t.Parallel()

		_, err := DecodeConfig(123)
		assert.Error(t, err)
	})
}

func TestConfigBuildSpanner(t *testing.T) {
	t.Parallel()

	dialect, err := database.Config{
		Raw: map[string]any{
			"spanner": "projects/p/instances/i/databases/d",
		},
	}.Build()
	require.NoError(t, err)
	assert.Equal(t, "spanner", dialect.Name())
}
