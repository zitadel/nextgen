package server

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"log/slog"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

const (
	defaultDataDirName = "nextgen-data"
	// masterKeyFileName is the name of the auto-generated master key file. It
	// doubles as the key ID, since keys discovered in the master key directory
	// are identified by their file name.
	masterKeyFileName       = "master-key.pem"
	defaultMasterKeyDirName = "master-keys"
)

// defaultServerDataDir computes the fallback data dir and must stay free of
// side effects: it runs while seeding config defaults, before configuration has
// selected a data dir. Creating a directory here would make the process depend
// on a location it may never use — the container entrypoint sits in root-owned
// /usr/local/bin, so an eager mkdir there aborts startup for the image's own
// non-root user even when data_dir points somewhere writable.
// Use ensureServerDataDir once the configured dir is known.
func defaultServerDataDir() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("resolve executable path: %w", err)
	}
	return filepath.Join(filepath.Dir(exe), defaultDataDirName), nil
}

func ensureServerDataDir(path string) error {
	if err := os.MkdirAll(path, 0o700); err != nil {
		return fmt.Errorf("failed to create server data dir: %w", err)
	}
	return nil
}

func serverMasterKeyDir(cfg ServerConfig) (string, error) {
	dataDir := cfg.DataDir
	if dataDir == "" {
		defaultDir, err := defaultServerDataDir()
		if err != nil {
			return "", err
		}
		dataDir = defaultDir
	}
	path := filepath.Join(dataDir, defaultMasterKeyDirName)
	err := os.MkdirAll(path, 0o700)
	if err != nil {
		return "", fmt.Errorf("failed to create master key dir: %w", err)
	}
	return path, nil
}

func ensureServerMasterKey(cfg *ServerConfig) error {
	masterKeyDir, err := serverMasterKeyDir(*cfg)
	if err != nil {
		return fmt.Errorf("failed to get master key directory: %w", err)
	}

	keysFromFileSystem, err := loadMasterKeysFromFileSystem(masterKeyDir, len(cfg.MasterKeys) == 0)
	if err != nil {
		return err
	}

	if len(cfg.MasterKeys) > 0 {
		maps.Copy(cfg.MasterKeys, keysFromFileSystem)
	} else {
		cfg.MasterKeys = keysFromFileSystem
	}

	if len(cfg.MasterKeys) == 0 {
		if !cfg.GenerateMasterKey {
			return fmt.Errorf(
				"no master key: server.master_keys is unset and %s holds no key file, "+
					"while master key generation is off (--%s / server.generate_master_key: false). "+
					"Configure server.master_keys, or place a key file in that directory",
				masterKeyDir, flagDisableMasterKeyGeneration)
		}

		filePath, err := createMasterKey(masterKeyDir)
		if err != nil {
			return err
		}
		cfg.MasterKeys = map[string]*MasterKeyConfig{
			masterKeyFileName: {
				File:             filePath,
				UseForEncryption: true,
			},
		}
		// A warning rather than a bare stderr line: on ephemeral storage this
		// is the moment a deployment starts losing data, and it has to survive
		// aggregated logs. Logging is not configured yet -- loadConfig runs
		// before setUpLogging -- so this goes through the default handler.
		slog.Warn("created server master key file (generated for local/dev only; configure server.master_keys for production)",
			slog.String("path", filePath),
			slog.String("disable_with", "--"+flagDisableMasterKeyGeneration))
	}

	return nil
}

func loadMasterKeysFromFileSystem(dir string, containsActiveKey bool) (map[string]*MasterKeyConfig, error) {
	files, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("failed to list master key directory: %w", err)
	}

	var newestKey *MasterKeyConfig
	var newestFileModTime time.Time
	keysFromDir := make(map[string]*MasterKeyConfig, len(files))
	for _, file := range files {
		if file.IsDir() {
			continue
		}

		info, err := file.Info()
		if err != nil {
			return nil, fmt.Errorf("failed to get info of file %s: %w", file.Name(), err)
		}
		keyPath := filepath.Join(dir, file.Name())
		key := &MasterKeyConfig{
			File: keyPath,
		}
		if info.ModTime().After(newestFileModTime) {
			newestKey = key
			newestFileModTime = info.ModTime()
		}

		keysFromDir[file.Name()] = key
	}

	if containsActiveKey && newestKey != nil {
		newestKey.UseForEncryption = true
	}
	return keysFromDir, nil
}

// masterKeyEnvPrefix is the environment prefix that cannot work.
// server.master_keys is a map keyed by key id, and viper's AutomaticEnv has no
// way to discover map keys, so every NEXTGEN_SERVER_MASTER_KEYS_* variable is
// dropped in silence -- and dropping it is what leaves the server with no
// configured key, which is what makes it generate one.
const masterKeyEnvPrefix = "NEXTGEN_SERVER_MASTER_KEYS_"

// warnIgnoredMasterKeyEnv reports master key environment variables that cannot
// reach the configuration, so an operator who set them learns it here rather
// than from unwrappable data later.
func warnIgnoredMasterKeyEnv(environ []string) {
	ignored := ignoredMasterKeyEnv(environ)
	if len(ignored) == 0 {
		return
	}
	slog.Warn("ignoring master key environment variables: server.master_keys is keyed by key id and cannot be set from the environment; configure it in the config file, or place the key file in the master key directory",
		slog.Any("variables", ignored))
}

func ignoredMasterKeyEnv(environ []string) []string {
	var ignored []string
	for _, entry := range environ {
		name, _, ok := strings.Cut(entry, "=")
		if ok && strings.HasPrefix(name, masterKeyEnvPrefix) {
			ignored = append(ignored, name)
		}
	}
	slices.Sort(ignored)
	return ignored
}

func createMasterKey(dir string) (string, error) {
	key, err := rsa.GenerateKey(rand.Reader, 4096)
	if err != nil {
		return "", fmt.Errorf("failed to generate RSA key: %w", err)
	}

	bs := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(key),
	})

	path := filepath.Join(dir, masterKeyFileName)
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return "", fmt.Errorf("failed to create master key file %q: %w", path, err)
	}
	if _, err := f.Write(bs); err != nil {
		_ = f.Close()
		return "", fmt.Errorf("failed to write master key file %q: %w", path, err)
	}
	if err := f.Close(); err != nil {
		return "", fmt.Errorf("failed to close master key file %q: %w", path, err)
	}

	return path, nil
}
