package server

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/passwap/argon2"
	"github.com/zitadel/passwap/bcrypt"
)

func TestLoadConfigReadsPostgresDatabaseEnv(t *testing.T) {
	t.Setenv("NEXTGEN_SERVER_DATA_DIR", t.TempDir())
	t.Setenv("NEXTGEN_DATABASE_POSTGRES", "postgresql://postgres@localhost:5432/nextgen?sslmode=disable")

	configPath := filepath.Join(t.TempDir(), "nextgen.yaml")
	require.NoError(t, os.WriteFile(configPath, nil, 0o600))

	cfg, err := loadConfig(configPath)
	require.NoError(t, err)

	postgresConfig, ok := cfg.Database.Raw["postgres"]
	require.True(t, ok)

	assert.Equal(t, "postgresql://postgres@localhost:5432/nextgen?sslmode=disable", postgresConfig)
}

// TestLoadConfigDefaultsToArgon2id locks in the ADR 029 default: with no
// password_hasher overrides, the built hasher produces argon2id hashes while
// still verifying (and rehashing) pre-existing bcrypt hashes.
func TestLoadConfigDefaultsToArgon2id(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "nextgen.yaml")
	require.NoError(t, os.WriteFile(configPath, nil, 0o600))

	cfg, err := loadConfig(configPath)
	require.NoError(t, err)

	hasher, err := cfg.PasswordHasher.NewHasher()
	require.NoError(t, err)

	const password = "Passw0rd!"
	encoded, err := hasher.Hash(password)
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(encoded, argon2.Prefix), "default hasher should produce argon2id, got %q", encoded)

	// Pre-existing bcrypt hash still verifies and is rehashed to argon2id.
	legacy, err := bcrypt.New(10, nil).Hash(password)
	require.NoError(t, err)
	rehashed, err := hasher.Verify(legacy, password)
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(rehashed, argon2.Prefix), "bcrypt hash should rehash to argon2id, got %q", rehashed)
}
