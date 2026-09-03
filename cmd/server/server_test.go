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

func TestConsoleBaseURL(t *testing.T) {
	tests := []struct {
		name       string
		publicBase string
		want       string
		wantErr    bool
	}{
		{name: "plain origin", publicBase: "http://localhost:8080", want: "http://localhost:8080/ui/console"},
		{name: "trailing slash trimmed", publicBase: "https://nextgen.zitadel.cloud/", want: "https://nextgen.zitadel.cloud/ui/console"},
		{name: "path prefix kept", publicBase: "https://proxy.example.com/nextgen", want: "https://proxy.example.com/nextgen/ui/console"},
		{name: "missing scheme", publicBase: "localhost:8080", wantErr: true},
		{name: "empty", publicBase: "", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := consoleBaseURL(tt.publicBase, "/ui/console")
			if tt.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestLoadConfigServerPublicBase(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "nextgen.yaml")
	require.NoError(t, os.WriteFile(configPath, nil, 0o600))

	cfg, err := loadConfig(configPath)
	require.NoError(t, err)
	assert.Equal(t, "https://nextgen.zitadel.cloud", cfg.Server.PublicBase)

	t.Setenv("NEXTGEN_SERVER_PUBLIC_BASE", "http://localhost:9999")
	cfg, err = loadConfig(configPath)
	require.NoError(t, err)
	assert.Equal(t, "http://localhost:9999", cfg.Server.PublicBase)
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
