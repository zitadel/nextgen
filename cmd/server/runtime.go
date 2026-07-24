package server

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const (
	defaultDataDirName = "nextgen-data"
	defaultKEKDirName  = "keks"
)

func defaultServerDataDir() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("resolve executable path: %w", err)
	}
	path := filepath.Join(filepath.Dir(exe), defaultDataDirName)
	err = os.MkdirAll(path, 0o700)
	if err != nil {
		return "", fmt.Errorf("failed to create server data dir: %w", err)
	}
	return path, nil
}

func serverKEKDir(cfg ServerConfig) (string, error) {
	dataDir := cfg.DataDir
	if dataDir == "" {
		defaultDir, err := defaultServerDataDir()
		if err != nil {
			return "", err
		}
		dataDir = defaultDir
	}
	path := filepath.Join(dataDir, defaultKEKDirName)
	err := os.MkdirAll(path, 0o700)
	if err != nil {
		return "", fmt.Errorf("failed to KEK dir: %w", err)
	}
	return path, nil
}

func ensureServerKEK(cfg *ServerConfig) error {
	kekDir, err := serverKEKDir(*cfg)
	if err != nil {
		return fmt.Errorf("failed to get KEK directory: %w", err)
	}

	files, err := os.ReadDir(kekDir)
	if err != nil {
		return fmt.Errorf("failed to list KEK directory: %w", err)
	}

	var newestFile string
	var newestFileModTime time.Time
	keysFromDir := make([]EncryptionKeyConfig, 0, len(files))
	for _, file := range files {
		if file.IsDir() {
			continue
		}

		info, err := file.Info()
		if err != nil {
			return fmt.Errorf("failed to get info of file %s: %w", file.Name(), err)
		}
		keyPath := filepath.Join(kekDir, file.Name())
		if info.ModTime().After(newestFileModTime) {
			newestFile = keyPath
			newestFileModTime = info.ModTime()
		}

		keysFromDir = append(keysFromDir, EncryptionKeyConfig{
			ID:   file.Name(),
			File: keyPath,
		})
	}

	if len(cfg.EncryptionKeys) > 0 {
		cfg.EncryptionKeys = append(cfg.EncryptionKeys, keysFromDir...)
	} else {
		for i := range keysFromDir {
			if keysFromDir[i].File == newestFile {
				keysFromDir[i].UseForEncryption = true
				break
			}
		}
		cfg.EncryptionKeys = keysFromDir
	}

	if len(cfg.EncryptionKeys) == 0 {
		filePath, err := createEncryptionKey(kekDir)
		if err != nil {
			return err
		}
		cfg.EncryptionKeys = []EncryptionKeyConfig{
			{
				ID:               "root-kek.pem",
				File:             filePath,
				UseForEncryption: true,
			},
		}
		fmt.Fprintf(os.Stderr, "created server encryption key file at %s\n", kekDir)
	}

	return nil
}

func createEncryptionKey(dir string) (string, error) {
	key, err := rsa.GenerateKey(rand.Reader, 4096)
	if err != nil {
		return "", fmt.Errorf("failed to generate RSA key: %w", err)
	}

	bs := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(key),
	})

	path := filepath.Join(dir, "root-kek.pem")
	if err := os.WriteFile(path, bs, 0o600); err != nil {
		return "", fmt.Errorf("failed to create kek file %q: %w", path, err)
	}

	return path, nil
}
