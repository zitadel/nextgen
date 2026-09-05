package server

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"os"
	"path/filepath"
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

	files, err := os.ReadDir(masterKeyDir)
	if err != nil {
		return fmt.Errorf("failed to list master key directory: %w", err)
	}

	var newestFile string
	var newestFileModTime time.Time
	keysFromDir := make(map[string]*MasterKeyConfig, len(files))
	for _, file := range files {
		// Skip dot-prefixed entries. A key's file name doubles as its key ID, so
		// no key an operator authored starts with a dot — but plenty of
		// machinery does. Kubernetes-style projected secret volumes (which
		// Cloud Run and GKE both use for mounted secrets) fill the directory
		// with `..data -> ..<timestamp>/` alongside the key itself, and
		// editors and macOS leave swap files and .DS_Store behind.
		if strings.HasPrefix(file.Name(), ".") {
			continue
		}

		keyPath := filepath.Join(masterKeyDir, file.Name())
		// os.Stat rather than file.Info(): DirEntry reports on the link itself,
		// so a symlinked directory looks like a regular file and would be
		// adopted as a key. Following the link also means the mod time that
		// picks the newest key is the key's, not the link's.
		info, err := os.Stat(keyPath)
		if err != nil {
			return fmt.Errorf("failed to get info of file %s: %w", file.Name(), err)
		}
		if info.IsDir() {
			continue
		}

		if info.ModTime().After(newestFileModTime) {
			newestFile = keyPath
			newestFileModTime = info.ModTime()
		}

		keysFromDir[file.Name()] = &MasterKeyConfig{
			File: keyPath,
		}
	}

	if len(cfg.MasterKeys) > 0 {
		for id, key := range keysFromDir {
			cfg.MasterKeys[id] = key
		}
	} else {
		for id, key := range keysFromDir {
			if key.File == newestFile {
				keysFromDir[id].UseForEncryption = true
				break
			}
		}
		cfg.MasterKeys = keysFromDir
	}

	if len(cfg.MasterKeys) == 0 {
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
		// TODO: add a flag which allows to disable the auto generation of a master key (https://github.com/zitadel/nextgen/issues/655)
		fmt.Fprintf(os.Stderr, "created server master key file at %s (generated for local/dev only; configure server.master_keys for production)\n", filePath)
	}

	return nil
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
