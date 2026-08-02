package postgres

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDecodeConfig(t *testing.T) {
	t.Parallel()

	t.Run("connection string", func(t *testing.T) {
		t.Parallel()

		dialect, err := DecodeConfig("postgres://user:pass@localhost:5432/dbname?sslmode=disable")
		require.NoError(t, err)
		assert.Equal(t, "postgres", dialect.Name())

		require.IsType(t, &Config{}, dialect)
		pgConfig := dialect.(*Config)
		assert.Equal(t, "localhost", pgConfig.ConnConfig.Host)
		assert.Equal(t, uint16(5432), pgConfig.ConnConfig.Port)
		assert.Equal(t, "dbname", pgConfig.ConnConfig.Database)
	})

	t.Run("map configuration", func(t *testing.T) {
		t.Parallel()

		dialect, err := DecodeConfig(map[string]any{
			"ConnConfig": map[string]any{
				"Host":     "db.example",
				"Port":     5433,
				"Database": "zitadel",
				"User":     "zitadel",
			},
		})
		require.NoError(t, err)
		assert.Equal(t, "postgres", dialect.Name())

		require.IsType(t, &Config{}, dialect)
		pgConfig := dialect.(*Config)
		require.NotNil(t, pgConfig.ConnConfig)
		assert.Equal(t, "db.example", pgConfig.ConnConfig.Host)
		assert.Equal(t, uint16(5433), pgConfig.ConnConfig.Port)
		assert.Equal(t, "zitadel", pgConfig.ConnConfig.Database)
		assert.Equal(t, "zitadel", pgConfig.ConnConfig.User)
	})

	t.Run("invalid input type", func(t *testing.T) {
		t.Parallel()

		_, err := DecodeConfig(123)
		assert.Error(t, err)
	})
}
