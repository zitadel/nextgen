package server

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

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

	if assert.Contains(t, cfg.Server.EncryptionKeys, "root-kek.pem") {
		assert.Equal(t, &EncryptionKeyConfig{
			File:             keyFilePath,
			UseForEncryption: true,
		}, cfg.Server.EncryptionKeys["root-kek.pem"])
	}

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
    configured-kek: 
      use_for_encryption: true
      private_key: configured-private-key
`), 0o600))

	cfg, err := loadConfig(configPath)
	require.NoError(t, err)

	// A configured key means ensureServerKEK generates nothing: the KEK
	// directory is created but no key file is written into it.
	require.Len(t, cfg.Server.EncryptionKeys, 1)
	if assert.Contains(t, cfg.Server.EncryptionKeys, "configured-kek") {
		assert.Equal(t, &EncryptionKeyConfig{
			UseForEncryption: true,
			PrivateKey:       "configured-private-key",
		}, cfg.Server.EncryptionKeys["configured-kek"])
	}

	// The directory exists, but no key file was generated.
	entries, err := os.ReadDir(filepath.Join(dataDir, defaultKEKDirName))
	require.NoError(t, err)
	assert.Empty(t, entries, "no key file should be generated when a key is configured")
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

// writeKEKFile writes a KEK file with a specific modification time so tests can
// control which key is considered the newest.
func writeKEKFile(t *testing.T, kekDir, name string, modTime time.Time) string {
	t.Helper()
	path := filepath.Join(kekDir, name)
	require.NoError(t, os.WriteFile(path, []byte(name), 0o600))
	require.NoError(t, os.Chtimes(path, modTime, modTime))
	return path
}

func TestEnsureServerKEKLoadsAllKeysAndMarksNewestForEncryption(t *testing.T) {
	dataDir := t.TempDir()
	kekDir := filepath.Join(dataDir, defaultKEKDirName)
	require.NoError(t, os.MkdirAll(kekDir, 0o700))

	// Three keys with increasing modification times; the last is the newest.
	base := time.Now()
	oldest := writeKEKFile(t, kekDir, "kek-1.pem", base.Add(-2*time.Hour))
	middle := writeKEKFile(t, kekDir, "kek-2.pem", base.Add(-1*time.Hour))
	newest := writeKEKFile(t, kekDir, "kek-3.pem", base)

	cfg := &ServerConfig{DataDir: dataDir}
	require.NoError(t, ensureServerKEK(cfg))

	// Every key file is loaded as a file-backed entry.
	require.Len(t, cfg.EncryptionKeys, 3)
	if assert.Contains(t, cfg.EncryptionKeys, "kek-1.pem") {
		assert.Equal(t, cfg.EncryptionKeys["kek-1.pem"], &EncryptionKeyConfig{File: oldest})
	}
	if assert.Contains(t, cfg.EncryptionKeys, "kek-2.pem") {
		assert.Equal(t, cfg.EncryptionKeys["kek-2.pem"], &EncryptionKeyConfig{File: middle})
	}
	if assert.Contains(t, cfg.EncryptionKeys, "kek-3.pem") {
		assert.Equal(t, cfg.EncryptionKeys["kek-3.pem"], &EncryptionKeyConfig{File: newest, UseForEncryption: true})
	}

	// Exactly one key is marked for encryption, and it is the newest.
	var forEncryption []*EncryptionKeyConfig
	for _, k := range cfg.EncryptionKeys {
		if k.UseForEncryption {
			forEncryption = append(forEncryption, k)
		}
	}
	require.Len(t, forEncryption, 1)
	assert.Equal(t, newest, forEncryption[0].File)
}
