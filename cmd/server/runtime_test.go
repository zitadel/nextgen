package server

import (
	"os"
	"path/filepath"
	"runtime"
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

	keyDir := filepath.Join(dataDir, defaultKEKDirName)
	assert.DirExists(t, keyDir)

	entries, err := os.ReadDir(keyDir)
	require.NoError(t, err)
	var keyFilePath string
	for _, e := range entries {
		if !e.IsDir() {
			keyFilePath = filepath.Join(keyDir, e.Name())
			break
		}
	}
	assert.NotEmpty(t, keyFilePath)
	assert.FileExists(t, keyFilePath)

	assert.Contains(t, cfg.Server.EncryptionKeys, EncryptionKeyConfig{
		ID:               "root-kek.pem",
		File:             keyFilePath,
		UseForEncryption: true,
	})

	if runtime.GOOS != "windows" {
		info, err := os.Stat(keyFilePath)
		require.NoError(t, err)
		assert.Equal(t, os.FileMode(0o600), info.Mode().Perm())
	}

	cfg2, err := loadConfig(configPath)
	require.NoError(t, err)
	assert.Equal(t, cfg.Server.EncryptionKeys, cfg2.Server.EncryptionKeys)
}

func TestLoadConfigDoesNotCreateEncryptionKeyFileWhenKeyConfigured(t *testing.T) {
	dataDir := t.TempDir()
	t.Setenv("NEXTGEN_SERVER_DATA_DIR", dataDir)

	configPath := filepath.Join(t.TempDir(), "nextgen.yaml")
	require.NoError(t, os.WriteFile(configPath, []byte(`
server:
  encryption_keys:
    - id: configured-kek
      use_for_encryption: true
      private_key: configured-private-key
`), 0o600))

	cfg, err := loadConfig(configPath)
	require.NoError(t, err)

	// A configured key short-circuits ensureServerKEK, so no KEK is generated
	// and no key directory is created below the data dir.
	require.Len(t, cfg.Server.EncryptionKeys, 1)
	assert.Equal(t, "configured-kek", cfg.Server.EncryptionKeys[0].ID)
	assert.True(t, cfg.Server.EncryptionKeys[0].UseForEncryption)
	assert.Equal(t, "configured-private-key", cfg.Server.EncryptionKeys[0].PrivateKey)
	assert.NoDirExists(t, filepath.Join(dataDir, defaultKEKDirName))
}

func TestEmbeddedPostgresOptionsUseDataDir(t *testing.T) {
	dataDir := t.TempDir()

	options := embeddedPostgresOptions(dataDir)

	root := filepath.Join(dataDir, "embedded-postgres")
	assert.Equal(t, filepath.Join(root, "runtime"), options.RuntimePath)
	assert.Equal(t, filepath.Join(root, "data"), options.DataPath)
	assert.Equal(t, filepath.Join(root, "cache"), options.CachePath)
	assert.Equal(t, filepath.Join(root, "postgres.log"), options.LogPath)
	assert.NotEqual(t, options.RuntimePath, filepath.Dir(options.DataPath))
	assert.NotEqual(t, options.RuntimePath, options.CachePath)
}
