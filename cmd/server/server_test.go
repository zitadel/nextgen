package server

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadConfigReadsPostgresDatabaseEnv(t *testing.T) {
	t.Setenv("NEXTGEN_SERVER_COOKIE_SEALER_KEY", "4D61737465726B65794E65656473546F48617665333243686172616374657273")
	t.Setenv("NEXTGEN_DATABASE_POSTGRES", "postgresql://postgres@localhost:5432/nextgen?sslmode=disable")

	configPath := filepath.Join(t.TempDir(), "nextgen.yaml")
	_, err := os.Create(configPath)
	require.NoError(t, err)

	cfg, err := loadConfig(configPath)
	require.NoError(t, err)

	postgresConfig, ok := cfg.Database.Raw["postgres"]
	require.True(t, ok)

	assert.Equal(t, "postgresql://postgres@localhost:5432/nextgen?sslmode=disable", postgresConfig)
	assert.Equal(t, "4D61737465726B65794E65656473546F48617665333243686172616374657273", cfg.Server.EncryptionKey)
}
