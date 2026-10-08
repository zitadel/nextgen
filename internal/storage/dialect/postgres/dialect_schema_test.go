package postgres

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	pgschema "github.com/zitadel/nextgen/internal/storage/dialect/postgres/schema"
)

func TestDecodeConfigSchema(t *testing.T) {
	t.Parallel()

	decode := func(t *testing.T, input any) *Config {
		t.Helper()
		dialect, err := DecodeConfig(input)
		require.NoError(t, err)
		require.IsType(t, &Config{}, dialect)
		return dialect.(*Config)
	}

	t.Run("defaults to the default schema", func(t *testing.T) {
		t.Parallel()

		config := decode(t, "postgres://user:pass@localhost:5432/dbname?sslmode=disable")
		assert.Equal(t, pgschema.Default, config.Schema)
		assert.NotContains(t, config.ConnConfig.RuntimeParams, searchPathParam)
	})

	t.Run("search_path names the schema and keeps public reachable", func(t *testing.T) {
		t.Parallel()

		config := decode(t, "postgres://user:pass@localhost:5432/dbname?search_path=pr_42")
		assert.Equal(t, "pr_42", config.Schema)
		assert.Equal(t, "pr_42, public", config.ConnConfig.RuntimeParams[searchPathParam])
	})

	t.Run("a search_path that lists public is kept verbatim", func(t *testing.T) {
		t.Parallel()

		config := decode(t, "postgres://user:pass@localhost:5432/dbname?search_path=pr_42,public")
		assert.Equal(t, "pr_42", config.Schema)
		assert.Equal(t, "pr_42,public", config.ConnConfig.RuntimeParams[searchPathParam])
	})

	t.Run("the schema must be a plain identifier", func(t *testing.T) {
		t.Parallel()

		_, err := DecodeConfig("postgres://user:pass@localhost:5432/dbname?search_path=Pr-42")
		assert.Error(t, err)
	})

	t.Run("map form names the schema beside the connection", func(t *testing.T) {
		t.Parallel()

		config := decode(t, map[string]any{
			"schema":   "pr_7",
			"host":     "db.example",
			"database": "zitadel",
		})
		assert.Equal(t, "pr_7", config.Schema)
		assert.Equal(t, "db.example", config.ConnConfig.Host)
		assert.Equal(t, "zitadel", config.ConnConfig.Database)
	})

	t.Run("map form rejects a non-string or invalid schema", func(t *testing.T) {
		t.Parallel()

		_, err := DecodeConfig(map[string]any{"schema": 7, "host": "db.example"})
		assert.Error(t, err)
		_, err = DecodeConfig(map[string]any{"schema": "Bad Name", "host": "db.example"})
		assert.Error(t, err)
	})
}
