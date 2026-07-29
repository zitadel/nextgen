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
		return "", fmt.Errorf("failed to create KEK dir: %w", err)
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
	keysFromDir := make(map[string]*EncryptionKeyConfig, len(files))
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

		keysFromDir[file.Name()] = &EncryptionKeyConfig{
			File: keyPath,
		}
	}

	if len(cfg.EncryptionKeys) > 0 {
		for id, key := range keysFromDir {
			cfg.EncryptionKeys[id] = key
		}
	} else {
		for id, key := range keysFromDir {
			if key.File == newestFile {
				keysFromDir[id].UseForEncryption = true
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
		cfg.EncryptionKeys = map[string]*EncryptionKeyConfig{
			"root-kek.pem": {
				File:             filePath,
				UseForEncryption: true,
			},
		}
		// TODO: add a flag which allows to disable the auto generation of a KEK (https://github.com/zitadel/nextgen/issues/655)
		fmt.Fprintf(os.Stderr, "created server KEK file at %s (generated for local/dev only; configure server.encryption_keys for production)\n", filePath)
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
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return "", fmt.Errorf("failed to create kek file %q: %w", path, err)
	}
	if _, err := f.Write(bs); err != nil {
		_ = f.Close()
		return "", fmt.Errorf("failed to write kek file %q: %w", path, err)
	}
	if err := f.Close(); err != nil {
		return "", fmt.Errorf("failed to close kek file %q: %w", path, err)
	}

	return path, nil
}
