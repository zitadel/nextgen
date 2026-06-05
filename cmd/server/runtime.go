package server

import (
	cryptorand "crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	defaultDataDirName           = "nextgen-data"
	defaultEncryptionKeyFileName = "server-encryption-key"
)

func defaultServerDataDir() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("resolve executable path: %w", err)
	}
	return filepath.Join(filepath.Dir(exe), defaultDataDirName), nil
}

func ensureServerEncryptionKey(cfg *ServerConfig) error {
	if cfg.EncryptionKey != "" {
		return nil
	}

	keyPath, err := serverEncryptionKeyPath(*cfg)
	if err != nil {
		return err
	}

	key, created, err := readOrCreateEncryptionKey(keyPath)
	if err != nil {
		return err
	}
	cfg.EncryptionKey = key
	cfg.EncryptionKeyFile = keyPath

	if created {
		fmt.Fprintf(os.Stderr, "created server encryption key file at %s\n", keyPath)
	}
	return nil
}

func serverEncryptionKeyPath(cfg ServerConfig) (string, error) {
	if cfg.EncryptionKeyFile != "" {
		return cfg.EncryptionKeyFile, nil
	}
	dataDir := cfg.DataDir
	if dataDir == "" {
		defaultDir, err := defaultServerDataDir()
		if err != nil {
			return "", err
		}
		dataDir = defaultDir
	}
	return filepath.Join(dataDir, defaultEncryptionKeyFileName), nil
}

func readOrCreateEncryptionKey(path string) (key string, created bool, err error) {
	existing, err := os.ReadFile(path)
	if err == nil {
		return strings.TrimSpace(string(existing)), false, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return "", false, fmt.Errorf("read server encryption key file %q: %w", path, err)
	}

	keyBytes := make([]byte, 32)
	if _, err := cryptorand.Read(keyBytes); err != nil {
		return "", false, fmt.Errorf("generate server encryption key: %w", err)
	}
	encoded := hex.EncodeToString(keyBytes)

	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return "", false, fmt.Errorf("create server data directory: %w", err)
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if errors.Is(err, os.ErrExist) {
		key, _, err := readOrCreateEncryptionKey(path)
		return key, false, err
	}
	if err != nil {
		return "", false, fmt.Errorf("create server encryption key file %q: %w", path, err)
	}
	defer file.Close()

	if _, err := file.WriteString(encoded + "\n"); err != nil {
		return "", false, fmt.Errorf("write server encryption key file %q: %w", path, err)
	}
	return encoded, true, nil
}
