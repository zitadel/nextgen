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

// clearDefaultDataDir removes the data dir beside the test binary so an earlier
// loadConfig test cannot make these assertions order-dependent. Safe to call:
// the parallel tests in this package never touch the default data dir.
func clearDefaultDataDir(t *testing.T) string {
	t.Helper()
	path, err := defaultServerDataDir()
	require.NoError(t, err)
	require.NotEmpty(t, path)
	require.NoError(t, os.RemoveAll(path))
	return path
}

// The container entrypoint lives in root-owned /usr/local/bin, so deriving the
// default must not touch the filesystem: an eager mkdir there aborted startup
// for the image's own non-root user even when data_dir pointed elsewhere.
func TestDefaultServerDataDirHasNoSideEffects(t *testing.T) {
	path := clearDefaultDataDir(t)

	_, err := defaultServerDataDir()
	require.NoError(t, err)

	assert.NoDirExists(t, path, "computing the default data dir must not create it")
}

func TestLoadConfigCreatesOnlyTheConfiguredDataDir(t *testing.T) {
	defaultDir := clearDefaultDataDir(t)
	dataDir := filepath.Join(t.TempDir(), "configured")
	t.Setenv("NEXTGEN_SERVER_DATA_DIR", dataDir)

	configPath := filepath.Join(t.TempDir(), "nextgen.yaml")
	require.NoError(t, os.WriteFile(configPath, nil, 0o600))

	cfg, err := loadConfig(configPath)
	require.NoError(t, err)

	assert.Equal(t, dataDir, cfg.Server.DataDir)
	assert.DirExists(t, dataDir)
	assert.NoDirExists(t, defaultDir, "the unused default data dir must not be created")
}

func TestEnsureServerDataDirReportsAnUnwritableParent(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("windows does not enforce the POSIX mode bits this test makes the parent unwritable with")
	}
	if os.Geteuid() == 0 {
		t.Skip("root ignores directory permissions")
	}
	parent := t.TempDir()
	require.NoError(t, os.Chmod(parent, 0o500))
	t.Cleanup(func() { _ = os.Chmod(parent, 0o700) })

	err := ensureServerDataDir(filepath.Join(parent, "nextgen-data"))

	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to create server data dir")
}

func TestLoadConfigCreatesAndReusesMasterKeyFile(t *testing.T) {
	dataDir := t.TempDir()
	t.Setenv("NEXTGEN_SERVER_DATA_DIR", dataDir)

	configPath := filepath.Join(t.TempDir(), "nextgen.yaml")
	require.NoError(t, os.WriteFile(configPath, nil, 0o600))

	cfg, err := loadConfig(configPath)
	require.NoError(t, err)

	keyDir := filepath.Join(dataDir, defaultMasterKeyDirName)
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

	if assert.Contains(t, cfg.Server.MasterKeys, masterKeyFileName) {
		assert.Equal(t, &MasterKeyConfig{
			File:             keyFilePath,
			UseForEncryption: true,
		}, cfg.Server.MasterKeys[masterKeyFileName])
	}

	if runtime.GOOS != "windows" {
		info, err := os.Stat(keyFilePath)
		require.NoError(t, err)
		assert.Equal(t, os.FileMode(0o600), info.Mode().Perm())
	}

	cfg2, err := loadConfig(configPath)
	require.NoError(t, err)
	assert.Equal(t, cfg.Server.MasterKeys, cfg2.Server.MasterKeys)
}

func TestLoadConfigDoesNotCreateMasterKeyFileWhenKeyConfigured(t *testing.T) {
	dataDir := t.TempDir()
	t.Setenv("NEXTGEN_SERVER_DATA_DIR", dataDir)

	configPath := filepath.Join(t.TempDir(), "nextgen.yaml")
	require.NoError(t, os.WriteFile(configPath, []byte(`
server:
  master_keys:
    configured-master-key: 
      use_for_encryption: true
      private_key: configured-private-key
`), 0o600))

	cfg, err := loadConfig(configPath)
	require.NoError(t, err)

	// A configured key means ensureServerMasterKey generates nothing: the master
	// key directory is created but no key file is written into it.
	require.Len(t, cfg.Server.MasterKeys, 1)
	if assert.Contains(t, cfg.Server.MasterKeys, "configured-master-key") {
		assert.Equal(t, &MasterKeyConfig{
			UseForEncryption: true,
			PrivateKey:       "configured-private-key",
		}, cfg.Server.MasterKeys["configured-master-key"])
	}

	// The directory exists, but no key file was generated.
	entries, err := os.ReadDir(filepath.Join(dataDir, defaultMasterKeyDirName))
	require.NoError(t, err)
	assert.Empty(t, entries, "no key file should be generated when a key is configured")
}

// Generation off is the production posture: on ephemeral storage a generated
// key is minted per instance, and project KEKs wrapped by one instance cannot be
// unwrapped by the next. Failing the start is the recoverable failure.
func TestLoadConfigFailsWhenMasterKeyGenerationIsDisabled(t *testing.T) {
	dataDir := t.TempDir()
	t.Setenv("NEXTGEN_SERVER_DATA_DIR", dataDir)
	t.Setenv("NEXTGEN_SERVER_GENERATE_MASTER_KEY", "false")

	configPath := filepath.Join(t.TempDir(), "nextgen.yaml")
	require.NoError(t, os.WriteFile(configPath, nil, 0o600))

	_, err := loadConfig(configPath)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "no master key")
	assert.Contains(t, err.Error(), flagDisableMasterKeyGeneration, "the error has to name the way back")

	entries, err := os.ReadDir(filepath.Join(dataDir, defaultMasterKeyDirName))
	require.NoError(t, err)
	assert.Empty(t, entries, "a refused start must not leave a key behind")
}

func TestLoadConfigUsesTheKeyDirectoryWhenGenerationIsDisabled(t *testing.T) {
	dataDir := t.TempDir()
	masterKeyDir := filepath.Join(dataDir, defaultMasterKeyDirName)
	require.NoError(t, os.MkdirAll(masterKeyDir, 0o700))
	keyPath := writeMasterKeyFile(t, masterKeyDir, "mounted-key.pem", time.Now())

	t.Setenv("NEXTGEN_SERVER_DATA_DIR", dataDir)
	t.Setenv("NEXTGEN_SERVER_GENERATE_MASTER_KEY", "false")

	configPath := filepath.Join(t.TempDir(), "nextgen.yaml")
	require.NoError(t, os.WriteFile(configPath, nil, 0o600))

	cfg, err := loadConfig(configPath)
	require.NoError(t, err, "a key that is present is still discovered with generation off")

	// This is how a container gets its key: mounted into the directory, which
	// is discovered by file name, with generation off as the guard.
	if assert.Contains(t, cfg.Server.MasterKeys, "mounted-key.pem") {
		assert.Equal(t, &MasterKeyConfig{File: keyPath, UseForEncryption: true},
			cfg.Server.MasterKeys["mounted-key.pem"])
	}
}

// The flag is the operator's last word: it has to beat a config file that says
// the opposite, which is what makes it usable as a deployment-wide guard.
func TestDisableMasterKeyGenerationFlagOutranksTheConfigFile(t *testing.T) {
	dataDir := t.TempDir()
	t.Setenv("NEXTGEN_SERVER_DATA_DIR", dataDir)

	configPath := filepath.Join(t.TempDir(), "nextgen.yaml")
	require.NoError(t, os.WriteFile(configPath, []byte(`
server:
  generate_master_key: true
`), 0o600))

	// Without the flag the config file wins and a key is generated.
	cfg, err := loadConfig(configPath)
	require.NoError(t, err)
	require.Len(t, cfg.Server.MasterKeys, 1)

	cmd := NewCommand()
	require.NoError(t, cmd.Flags().Set(flagDisableMasterKeyGeneration, "true"))
	overrides, err := flagOverrides(cmd.Flags())
	require.NoError(t, err)
	require.Len(t, overrides, 1)

	// A fresh data dir, so the key generated above is not the one found.
	t.Setenv("NEXTGEN_SERVER_DATA_DIR", t.TempDir())

	_, err = loadConfig(configPath, overrides...)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no master key")
}

func TestDefaultSQLitePathUsesDataDir(t *testing.T) {
	dataDir := t.TempDir()
	assert.Equal(t, filepath.Join(dataDir, "zitadel.db"), defaultSQLitePath(dataDir))
}

// writeMasterKeyFile writes a master key file with a specific modification time
// so tests can control which key is considered the newest.
func writeMasterKeyFile(t *testing.T, masterKeyDir, name string, modTime time.Time) string {
	t.Helper()
	path := filepath.Join(masterKeyDir, name)
	require.NoError(t, os.WriteFile(path, []byte(name), 0o600))
	require.NoError(t, os.Chtimes(path, modTime, modTime))
	return path
}

func TestEnsureServerMasterKeyLoadsAllKeysAndMarksNewestForEncryption(t *testing.T) {
	dataDir := t.TempDir()
	masterKeyDir := filepath.Join(dataDir, defaultMasterKeyDirName)
	require.NoError(t, os.MkdirAll(masterKeyDir, 0o700))

	// Three keys with increasing modification times; the last is the newest.
	base := time.Now()
	oldest := writeMasterKeyFile(t, masterKeyDir, "master-key-1.pem", base.Add(-2*time.Hour))
	middle := writeMasterKeyFile(t, masterKeyDir, "master-key-2.pem", base.Add(-1*time.Hour))
	newest := writeMasterKeyFile(t, masterKeyDir, "master-key-3.pem", base)

	cfg := &ServerConfig{DataDir: dataDir}
	require.NoError(t, ensureServerMasterKey(cfg))

	// Every key file is loaded as a file-backed entry.
	require.Len(t, cfg.MasterKeys, 3)
	if assert.Contains(t, cfg.MasterKeys, "master-key-1.pem") {
		assert.Equal(t, cfg.MasterKeys["master-key-1.pem"], &MasterKeyConfig{File: oldest})
	}
	if assert.Contains(t, cfg.MasterKeys, "master-key-2.pem") {
		assert.Equal(t, cfg.MasterKeys["master-key-2.pem"], &MasterKeyConfig{File: middle})
	}
	if assert.Contains(t, cfg.MasterKeys, "master-key-3.pem") {
		assert.Equal(t, cfg.MasterKeys["master-key-3.pem"], &MasterKeyConfig{File: newest, UseForEncryption: true})
	}

	// Exactly one key is marked for encryption, and it is the newest.
	var forEncryption []*MasterKeyConfig
	for _, k := range cfg.MasterKeys {
		if k.UseForEncryption {
			forEncryption = append(forEncryption, k)
		}
	}
	require.Len(t, forEncryption, 1)
	assert.Equal(t, newest, forEncryption[0].File)
}

// The variables this reports are the ones viper drops in silence: master_keys
// is a map keyed by key id, and AutomaticEnv cannot discover a map key.
func TestIgnoredMasterKeyEnv(t *testing.T) {
	got := ignoredMasterKeyEnv([]string{
		"NEXTGEN_SERVER_MASTER_KEYS_PRIMARY_USE_FOR_ENCRYPTION=true",
		"NEXTGEN_SERVER_DATA_DIR=/var/lib/nextgen",
		"NEXTGEN_SERVER_MASTER_KEYS_PRIMARY_PRIVATE_KEY=secret",
		"PATH=/usr/bin",
		"NEXTGEN_SERVER_MASTER_KEYSNOTAKEY=x",
	})

	assert.Equal(t, []string{
		"NEXTGEN_SERVER_MASTER_KEYS_PRIMARY_PRIVATE_KEY",
		"NEXTGEN_SERVER_MASTER_KEYS_PRIMARY_USE_FOR_ENCRYPTION",
	}, got, "only the master key variables, named without their values, in a stable order")
}

func TestIgnoredMasterKeyEnvReportsNothingWhenNoneAreSet(t *testing.T) {
	assert.Empty(t, ignoredMasterKeyEnv([]string{"NEXTGEN_SERVER_DATA_DIR=/tmp", "HOME=/root"}))
}
