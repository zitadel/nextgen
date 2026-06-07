package server

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadConfigCreatesAndReusesEncryptionKeyFile(t *testing.T) {
	dataDir := t.TempDir()
	t.Setenv("NEXTGEN_SERVER_DATA_DIR", dataDir)

	configPath := filepath.Join(t.TempDir(), "nextgen.yaml")
	require.NoError(t, os.WriteFile(configPath, nil, 0o600))

	cfg, err := loadConfig(configPath)
	require.NoError(t, err)

	keyPath := filepath.Join(dataDir, defaultEncryptionKeyFileName)
	raw, err := os.ReadFile(keyPath)
	require.NoError(t, err)

	key := strings.TrimSpace(string(raw))
	assert.Len(t, key, 64)
	assert.Equal(t, key, cfg.Server.EncryptionKey)
	assert.Equal(t, keyPath, cfg.Server.EncryptionKeyFile)

	if runtime.GOOS != "windows" {
		info, err := os.Stat(keyPath)
		require.NoError(t, err)
		assert.Equal(t, os.FileMode(0o600), info.Mode().Perm())
	}

	cfg, err = loadConfig(configPath)
	require.NoError(t, err)
	assert.Equal(t, key, cfg.Server.EncryptionKey)
}

func TestLoadConfigDoesNotCreateEncryptionKeyFileWhenKeyConfigured(t *testing.T) {
	dataDir := t.TempDir()
	t.Setenv("NEXTGEN_SERVER_DATA_DIR", dataDir)
	t.Setenv("NEXTGEN_SERVER_ENCRYPTION_KEY", "4D61737465726B65794E65656473546F48617665333243686172616374657273")

	configPath := filepath.Join(t.TempDir(), "nextgen.yaml")
	require.NoError(t, os.WriteFile(configPath, nil, 0o600))

	cfg, err := loadConfig(configPath)
	require.NoError(t, err)

	assert.Equal(t, "4D61737465726B65794E65656473546F48617665333243686172616374657273", cfg.Server.EncryptionKey)
	assert.NoFileExists(t, filepath.Join(dataDir, defaultEncryptionKeyFileName))
}

func TestEmbeddedPostgresOptionsUseDataDir(t *testing.T) {
	dataDir := t.TempDir()

	options := embeddedPostgresOptions(dataDir)

	root := filepath.Join(dataDir, "embedded-postgres")
	assert.Equal(t, filepath.Join(root, "runtime"), options.RuntimePath)
	assert.Equal(t, filepath.Join(root, "data"), options.DataPath)
	assert.Equal(t, filepath.Join(root, "postgres.log"), options.LogPath)
	assert.NotEqual(t, options.RuntimePath, filepath.Dir(options.DataPath))
}
