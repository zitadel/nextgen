package server

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/passwap/argon2"
	"github.com/zitadel/passwap/bcrypt"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/instrumentation"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
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
		name        string
		publicBase  string
		consolePath string
		want        string
		wantErr     bool
	}{
		{name: "plain origin", publicBase: "http://localhost:8080", want: "http://localhost:8080/ui/console"},
		{name: "trailing slash trimmed", publicBase: "https://nextgen.zitadel.cloud/", want: "https://nextgen.zitadel.cloud/ui/console"},
		{name: "path prefix kept", publicBase: "https://proxy.example.com/nextgen", want: "https://proxy.example.com/nextgen/ui/console"},
		{name: "console path trailing slash trimmed", publicBase: "http://localhost:8080", consolePath: "/ui/console/", want: "http://localhost:8080/ui/console"},
		{name: "missing scheme", publicBase: "localhost:8080", wantErr: true},
		{name: "empty", publicBase: "", wantErr: true},
		{name: "non-http scheme", publicBase: "ftp://example.com", wantErr: true},
		{name: "query rejected", publicBase: "https://example.com?x=y", wantErr: true},
		{name: "fragment rejected", publicBase: "https://example.com#frag", wantErr: true},
		{name: "userinfo rejected", publicBase: "https://user:pass@example.com", wantErr: true},
		{name: "console path without leading slash", publicBase: "http://localhost:8080", consolePath: "ui/console", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			consolePath := tt.consolePath
			if consolePath == "" {
				consolePath = "/ui/console"
			}
			got, err := consoleBaseURL(tt.publicBase, consolePath)
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

// TestLoadConfigSessionDefaults pins the session lifetimes of a server started
// with no session settings. session.default_ttl used to default to the
// anonymous shell's 10 minutes, which signed every user out 10 minutes after
// they signed in.
func TestLoadConfigSessionDefaults(t *testing.T) {
	t.Setenv("NEXTGEN_SERVER_DATA_DIR", t.TempDir())
	configPath := filepath.Join(t.TempDir(), "nextgen.yaml")
	require.NoError(t, os.WriteFile(configPath, nil, 0o600))

	cfg, err := loadConfig(configPath)
	require.NoError(t, err)
	assert.Equal(t, domain.SessionDefaultTTL, cfg.Session.DefaultTTL)
	assert.Equal(t, 720*time.Hour, cfg.Session.MaxTTL)
	assert.Greater(t, cfg.Session.DefaultTTL, domain.SessionAnonymousTTL,
		"a signed-in session must outlive an anonymous shell")

	t.Setenv("NEXTGEN_SESSION_DEFAULT_TTL", "168h")
	cfg, err = loadConfig(configPath)
	require.NoError(t, err)
	assert.Equal(t, 168*time.Hour, cfg.Session.DefaultTTL)
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
	encoded, err := hasher.Hash(t.Context(), password)
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(encoded, argon2.Prefix), "default hasher should produce argon2id, got %q", encoded)

	// Pre-existing bcrypt hash still verifies and is rehashed to argon2id.
	legacy, err := bcrypt.New(10, nil).Hash(password)
	require.NoError(t, err)
	rehashed, err := hasher.Verify(legacy, password)
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(rehashed, argon2.Prefix), "bcrypt hash should rehash to argon2id, got %q", rehashed)
}

// TestLoadConfigAcceptsDocumentedStringValues covers #1102: the enumer-generated
// types under instrumentation.log used to decode from integers only, because
// viper's decode hook has no encoding.TextUnmarshaler support by default. It
// also pins the regression that fix would otherwise reintroduce: viper.DecodeHook
// overrides rather than extends viper's own default hooks, so any decode hook
// wiring for the string enums has to keep the time.Duration and slice hooks too.
func TestLoadConfigAcceptsDocumentedStringValues(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "nextgen.yaml")
	require.NoError(t, os.WriteFile(configPath, []byte(`
instrumentation:
  log:
    level: debug
    format: json
    streams: [request, service]
session:
  default_ttl: 30m
  max_ttl: 48h
`), 0o600))

	cfg, err := loadConfig(configPath)
	require.NoError(t, err)

	assert.Equal(t, zlog.LevelDebug, cfg.Instrumentation.Log.Level)
	assert.Equal(t, instrumentation.LogFormatJSON, cfg.Instrumentation.Log.Format)
	assert.Equal(t, []zlog.Stream{zlog.StreamRequest, zlog.StreamService}, cfg.Instrumentation.Log.Streams)

	// time.Duration fields must still parse from duration strings — this is
	// what a hand-rolled decode hook silently breaks if it doesn't also
	// restate viper's default StringToTimeDurationHookFunc.
	assert.Equal(t, 30*time.Minute, cfg.Session.DefaultTTL)
	assert.Equal(t, 48*time.Hour, cfg.Session.MaxTTL)
}

// TestLoadConfigAcceptsStreamsFromEnv pins a narrower regression than the
// duration/slice check above: mapstructure.StringToSliceHookFunc (unlike
// viper's own unexported stringToWeakSliceHookFunc it would otherwise
// replace) only splits a string into a slice when the target element type
// is string, so a naive substitution silently stops a comma-separated
// NEXTGEN_INSTRUMENTATION_LOG_STREAMS env var from reaching []zlog.Stream.
func TestLoadConfigAcceptsStreamsFromEnv(t *testing.T) {
	t.Setenv("NEXTGEN_INSTRUMENTATION_LOG_STREAMS", "request,service")

	configPath := filepath.Join(t.TempDir(), "nextgen.yaml")
	require.NoError(t, os.WriteFile(configPath, nil, 0o600))

	cfg, err := loadConfig(configPath)
	require.NoError(t, err)

	assert.Equal(t, []zlog.Stream{zlog.StreamRequest, zlog.StreamService}, cfg.Instrumentation.Log.Streams)
}

// The hashing bound is on by default, with a wait before a refusal: a fresh
// deployment degrades a burst of sign-ins into retries, not into an OOM kill.
func TestLoadConfigDefaultsHashConcurrency(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "nextgen.yaml")
	require.NoError(t, os.WriteFile(configPath, nil, 0o600))

	cfg, err := loadConfig(configPath)
	require.NoError(t, err)

	assert.Equal(t, 0, cfg.PasswordHasher.Concurrency.MaxOperations, "one per CPU")
	assert.Equal(t, int64(512<<20), cfg.PasswordHasher.Concurrency.MemoryBudget)
	assert.Equal(t, time.Second, cfg.PasswordHasher.Concurrency.MaxWait)
}

// The keys are multi-word and reach the struct through their mapstructure
// tags, from a file and from the environment alike.
func TestLoadConfigHashConcurrencyOverrides(t *testing.T) {
	t.Setenv("NEXTGEN_PASSWORD_HASHER_CONCURRENCY_MAX_WAIT", "250ms")
	configPath := filepath.Join(t.TempDir(), "nextgen.yaml")
	require.NoError(t, os.WriteFile(configPath, []byte("password_hasher:\n  concurrency:\n    max_operations: 3\n    memory_budget: 1048576\n"), 0o600))

	cfg, err := loadConfig(configPath)
	require.NoError(t, err)

	assert.Equal(t, 3, cfg.PasswordHasher.Concurrency.MaxOperations)
	assert.Equal(t, int64(1<<20), cfg.PasswordHasher.Concurrency.MemoryBudget)
	assert.Equal(t, 250*time.Millisecond, cfg.PasswordHasher.Concurrency.MaxWait)
}
