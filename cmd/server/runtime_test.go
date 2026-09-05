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

// TestEnsureServerMasterKeyIgnoresProjectedVolumeMetadata reproduces the layout
// a Kubernetes-style projected secret volume creates — the shape Cloud Run and
// GKE both mount secrets with:
//
//	..2026_09_05_12_00_00.123456/master-key.pem   the real file
//	..data -> ..2026_09_05_12_00_00.123456        symlink to the timestamped dir
//	master-key.pem -> ..data/master-key.pem       symlink to the key
//
// `..data` is a symlink, so DirEntry.IsDir() reports false for it and a scan
// that only skips directories adopts it as a key named "..data". Startup then
// fails in buildMasterKey with "is a directory".
func TestEnsureServerMasterKeyIgnoresProjectedVolumeMetadata(t *testing.T) {
	dataDir := t.TempDir()
	masterKeyDir := filepath.Join(dataDir, defaultMasterKeyDirName)
	timestampedDir := filepath.Join(masterKeyDir, "..2026_09_05_12_00_00.123456")
	require.NoError(t, os.MkdirAll(timestampedDir, 0o700))

	require.NoError(t, os.WriteFile(filepath.Join(timestampedDir, masterKeyFileName), []byte("key-material"), 0o600))
	require.NoError(t, os.Symlink("..2026_09_05_12_00_00.123456", filepath.Join(masterKeyDir, "..data")))
	require.NoError(t, os.Symlink(filepath.Join("..data", masterKeyFileName), filepath.Join(masterKeyDir, masterKeyFileName)))

	cfg := &ServerConfig{DataDir: dataDir}
	require.NoError(t, ensureServerMasterKey(cfg))

	// Only the key itself is picked up: the "..data" symlink and the
	// timestamped directory behind it are both ignored.
	require.Len(t, cfg.MasterKeys, 1)
	require.Contains(t, cfg.MasterKeys, masterKeyFileName)
	assert.NotContains(t, cfg.MasterKeys, "..data")
	assert.Equal(t, &MasterKeyConfig{
		File:             filepath.Join(masterKeyDir, masterKeyFileName),
		UseForEncryption: true,
	}, cfg.MasterKeys[masterKeyFileName])

	// The mounted key was adopted, so no throwaway key was generated beside it.
	assert.NoFileExists(t, filepath.Join(timestampedDir, "master-key-generated.pem"))
}

// A symlink to a directory is not a key even without a dot prefix: DirEntry
// reports on the link, so only following it tells the two apart.
func TestEnsureServerMasterKeyIgnoresSymlinkedDirectory(t *testing.T) {
	dataDir := t.TempDir()
	masterKeyDir := filepath.Join(dataDir, defaultMasterKeyDirName)
	realDir := filepath.Join(masterKeyDir, "nested")
	require.NoError(t, os.MkdirAll(realDir, 0o700))
	require.NoError(t, os.Symlink("nested", filepath.Join(masterKeyDir, "linked-dir")))

	key := writeMasterKeyFile(t, masterKeyDir, masterKeyFileName, time.Now())

	cfg := &ServerConfig{DataDir: dataDir}
	require.NoError(t, ensureServerMasterKey(cfg))

	require.Len(t, cfg.MasterKeys, 1)
	assert.NotContains(t, cfg.MasterKeys, "linked-dir")
	assert.Equal(t, &MasterKeyConfig{File: key, UseForEncryption: true}, cfg.MasterKeys[masterKeyFileName])
}

// A stray dotfile — an editor swap file, .DS_Store — must not become a key, and
// must not suppress generation when it is the only thing in the directory.
func TestEnsureServerMasterKeyIgnoresStrayDotfile(t *testing.T) {
	dataDir := t.TempDir()
	masterKeyDir := filepath.Join(dataDir, defaultMasterKeyDirName)
	require.NoError(t, os.MkdirAll(masterKeyDir, 0o700))
	require.NoError(t, os.WriteFile(filepath.Join(masterKeyDir, ".DS_Store"), []byte("not a key"), 0o600))

	cfg := &ServerConfig{DataDir: dataDir}
	require.NoError(t, ensureServerMasterKey(cfg))

	// The dotfile is not a key, so the directory counts as empty and a key is
	// generated — under the generated name, not the dotfile's.
	require.Len(t, cfg.MasterKeys, 1)
	require.Contains(t, cfg.MasterKeys, masterKeyFileName)
	assert.NotContains(t, cfg.MasterKeys, ".DS_Store")
	assert.FileExists(t, filepath.Join(masterKeyDir, masterKeyFileName))
}
