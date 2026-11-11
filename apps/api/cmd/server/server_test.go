package server

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/passwap/argon2"
	"github.com/zitadel/passwap/bcrypt"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/background"
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

func TestConsoleOrigins(t *testing.T) {
	got, err := consoleOrigins("https://zitadel.example.com/nextgen", []string{" https://Console.Example.com:443 ", ""})
	require.NoError(t, err)
	assert.Equal(t, []string{"https://zitadel.example.com", "https://console.example.com"}, got,
		"the public base's origin first, then each configured one as a browser sends it")

	// A browser never sends these as an Origin, so they would never match.
	for _, entry := range []string{
		"console.example.com",
		"https://console.example.com/path",
		"https://console.example.com?q",
		"https://user:pass@console.example.com",
		"https://*.vercel.app",
		"https://console.example.com:",
		"https://bücher.example",
	} {
		_, err = consoleOrigins("https://zitadel.example.com", []string{entry})
		require.ErrorContains(t, err, "server.console_origins", entry)
	}
}

func TestPublicOrigin(t *testing.T) {
	tests := []struct {
		name       string
		publicBase string
		want       string
		wantErr    bool
	}{
		{name: "plain origin", publicBase: "http://localhost:8080", want: "http://localhost:8080"},
		{name: "trailing slash dropped", publicBase: "https://preview.zitadel.com/", want: "https://preview.zitadel.com"},
		{name: "path prefix dropped", publicBase: "https://proxy.example.com/nextgen", want: "https://proxy.example.com"},
		{name: "host lowercased", publicBase: "https://Zitadel.Example.com", want: "https://zitadel.example.com"},
		{name: "default port dropped", publicBase: "https://zitadel.example.com:443", want: "https://zitadel.example.com"},
		{name: "other port kept", publicBase: "https://zitadel.example.com:8443", want: "https://zitadel.example.com:8443"},
		{name: "empty", publicBase: "", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := publicOrigin(tt.publicBase)
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

// TestLoadConfigEventRetention pins the purge a server runs with no retention
// settings, its own hourly loop, and the trigger secret that hands the
// schedule to something outside the process: the key the cloud's launcher
// renders, or the environment, which outranks it.
func TestLoadConfigEventRetention(t *testing.T) {
	t.Setenv("NEXTGEN_SERVER_DATA_DIR", t.TempDir())
	t.Setenv("NEXTGEN_EVENTS_RETENTION_TRIGGER_SECRET", "")
	configPath := filepath.Join(t.TempDir(), "nextgen.yaml")
	require.NoError(t, os.WriteFile(configPath, nil, 0o600))

	cfg, err := loadConfig(configPath)
	require.NoError(t, err)
	assert.Equal(t, audit.RetentionConfig{Retention: 720 * time.Hour, Interval: time.Hour, Enabled: true}, cfg.Events.Retention)

	require.NoError(t, os.WriteFile(configPath, []byte("events:\n  retention:\n    trigger_secret: '0123456789abcdef-file'\n"), 0o600))
	cfg, err = loadConfig(configPath)
	require.NoError(t, err)
	assert.Equal(t, "0123456789abcdef-file", cfg.Events.Retention.TriggerSecret)

	t.Setenv("NEXTGEN_EVENTS_RETENTION_TRIGGER_SECRET", "0123456789abcdef-env")
	cfg, err = loadConfig(configPath)
	require.NoError(t, err)
	assert.Equal(t, "0123456789abcdef-env", cfg.Events.Retention.TriggerSecret)

	t.Setenv("NEXTGEN_EVENTS_RETENTION_TRIGGER_SECRET", "too short")
	_, err = loadConfig(configPath)
	assert.ErrorContains(t, err, "events.retention.trigger_secret must be at least 16 printable ASCII characters")
}

// The two settings the cloud's launcher makes for a server that runs only
// while it serves a request, read as it writes them into the environment.
func TestLoadConfigForAServerThatRunsOnlyWhileItServes(t *testing.T) {
	t.Setenv("NEXTGEN_SERVER_DATA_DIR", t.TempDir())
	t.Setenv("NEXTGEN_SERVER_IDLE_TIMEOUT", "")
	t.Setenv("NEXTGEN_EVENTS_REQUEST_FLUSH_WAIT", "")
	configPath := filepath.Join(t.TempDir(), "nextgen.yaml")
	require.NoError(t, os.WriteFile(configPath, nil, 0o600))

	cfg, err := loadConfig(configPath)
	require.NoError(t, err)
	assert.Equal(t, time.Minute, cfg.Server.IdleTimeout)
	assert.Equal(t, time.Minute, idleTimeout(cfg.Server.IdleTimeout))
	assert.Zero(t, cfg.Events.Request.FlushWait, "a request does not wait for its event")

	t.Setenv("NEXTGEN_SERVER_IDLE_TIMEOUT", "0")
	t.Setenv("NEXTGEN_EVENTS_REQUEST_FLUSH_WAIT", "2s")
	cfg, err = loadConfig(configPath)
	require.NoError(t, err)
	assert.Zero(t, cfg.Server.IdleTimeout)
	// net/http reads zero as "as long as ReadTimeout"; only a negative
	// timeout never closes an idle connection.
	assert.Negative(t, idleTimeout(cfg.Server.IdleTimeout))
	assert.Equal(t, 2*time.Second, cfg.Events.Request.FlushWait)
}

// server.request_bound is one fact about where the server runs, and the
// settings a pause changes take their defaults from it (ADR 089). Each stays
// a setting of its own: what the configuration says outranks the default.
func TestLoadConfigRequestBound(t *testing.T) {
	t.Setenv("NEXTGEN_SERVER_DATA_DIR", t.TempDir())
	for _, key := range []string{"NEXTGEN_SERVER_REQUEST_BOUND", "NEXTGEN_SERVER_IDLE_TIMEOUT", "NEXTGEN_EVENTS_REQUEST_FLUSH_WAIT"} {
		t.Setenv(key, "")
	}
	configPath := filepath.Join(t.TempDir(), "nextgen.yaml")
	require.NoError(t, os.WriteFile(configPath, nil, 0o600))

	cfg, err := loadConfig(configPath)
	require.NoError(t, err)
	assert.False(t, cfg.Server.RequestBound, "a server keeps running unless it is told otherwise")

	for name, set := range map[string]func(t *testing.T){
		"environment": func(t *testing.T) { t.Setenv("NEXTGEN_SERVER_REQUEST_BOUND", "true") },
		"file": func(t *testing.T) {
			require.NoError(t, os.WriteFile(configPath, []byte("server:\n  request_bound: true\n"), 0o600))
			t.Cleanup(func() { require.NoError(t, os.WriteFile(configPath, nil, 0o600)) })
		},
	} {
		t.Run(name, func(t *testing.T) {
			set(t)
			cfg, err := loadConfig(configPath)
			require.NoError(t, err)
			assert.True(t, cfg.Server.RequestBound)
			assert.Zero(t, cfg.Server.IdleTimeout, "the proxy's connections outlast a pause")
			assert.Equal(t, audit.RequestBoundFlushWait, cfg.Events.Request.FlushWait, "a request waits for its event")

			t.Setenv("NEXTGEN_SERVER_IDLE_TIMEOUT", "90s")
			t.Setenv("NEXTGEN_EVENTS_REQUEST_FLUSH_WAIT", "5s")
			cfg, err = loadConfig(configPath)
			require.NoError(t, err)
			assert.Equal(t, 90*time.Second, cfg.Server.IdleTimeout)
			assert.Equal(t, 5*time.Second, cfg.Events.Request.FlushWait)
		})
	}

	t.Run("the file's own values outrank the defaults", func(t *testing.T) {
		require.NoError(t, os.WriteFile(configPath, []byte("server:\n  request_bound: true\n  idle_timeout: 3m\nevents:\n  request:\n    flush_wait: 500ms\n"), 0o600))
		cfg, err := loadConfig(configPath)
		require.NoError(t, err)
		assert.Equal(t, 3*time.Minute, cfg.Server.IdleTimeout)
		assert.Equal(t, 500*time.Millisecond, cfg.Events.Request.FlushWait)
	})
}

// A request-bound server whose configuration leaves a background task with
// no way to run does not start: here the purge, which needs its trigger's
// secret, and the request events, which a wait of zero would write after the
// response. The error names the task and the setting.
func TestRunRefusesARequestBoundStartThatWouldSkipATask(t *testing.T) {
	for name, tc := range map[string]struct {
		set  func(*Config)
		want []string
	}{
		"no trigger secret": {
			set:  func(*Config) {},
			want: []string{"event retention cannot run on a timer where server.request_bound is set", "events.retention.trigger_secret"},
		},
		"no wait for the request event": {
			set:  func(cfg *Config) { cfg.Events.Request.FlushWait = 0 },
			want: []string{"request audit events where server.request_bound is set", "events.request.flush_wait is 0"},
		},
		"event export on": {
			set: func(cfg *Config) {
				cfg.Events.Retention.Enabled = false
				cfg.Events.Export.Enabled = true
			},
			want: []string{"event export cannot run where server.request_bound is set", "events.export.enabled"},
		},
		"service ping on": {
			set: func(cfg *Config) {
				cfg.Events.Retention.Enabled = false
				cfg.ServicePing.Enabled = true
			},
			want: []string{"service ping cannot run where server.request_bound is set", "service_ping.enabled"},
		},
	} {
		t.Run(name, func(t *testing.T) {
			_, configPath := tempServerConfig(t)
			t.Setenv("NEXTGEN_SERVER_REQUEST_BOUND", "true")
			cfg, err := loadConfig(configPath)
			require.NoError(t, err)
			tc.set(&cfg)

			// Bounded so that a start which no longer fails is reported
			// instead of waited on until go test's own timeout.
			ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
			defer cancel()
			err = run(ctx, cfg, nil, true)
			require.Error(t, err)
			for _, want := range tc.want {
				assert.ErrorContains(t, err, want)
			}
		})
	}
}

type rewrapRecorder struct {
	calls   chan struct{}
	release chan struct{}
}

func (r *rewrapRecorder) MigrateToLatestMasterKey(context.Context) error {
	r.calls <- struct{}{}
	<-r.release
	return nil
}

// The re-wrap has work only during a rotation. A server that keeps running
// re-wraps beside its requests; a request-bound one has re-wrapped by the
// time it takes its first, because nothing runs after a response there.
func TestMasterKeyRewrapTask(t *testing.T) {
	rotating := &domain.MasterKeys{Keys: []domain.MasterKey{{ID: "previous"}}, EncryptionKey: domain.MasterKey{ID: "current"}}

	t.Run("no previous key, no work", func(t *testing.T) {
		task := masterKeyRewrapTask(nil, &domain.MasterKeys{EncryptionKey: domain.MasterKey{ID: "current"}})
		assert.True(t, task.Disabled)
		for _, requestBound := range []bool{false, true} {
			require.NoError(t, background.NewGroup(requestBound).Start(t.Context(), task))
		}
	})
	t.Run("a server that keeps running re-wraps beside its requests", func(t *testing.T) {
		keys := &rewrapRecorder{calls: make(chan struct{}), release: make(chan struct{})}
		require.NoError(t, background.NewGroup(false).Start(t.Context(), masterKeyRewrapTask(keys, rotating)))
		<-keys.calls
		close(keys.release)
	})
	t.Run("a request-bound server re-wraps before it serves", func(t *testing.T) {
		keys := &rewrapRecorder{calls: make(chan struct{}, 1), release: make(chan struct{})}
		started := make(chan error, 1)
		go func() { started <- background.NewGroup(true).Start(t.Context(), masterKeyRewrapTask(keys, rotating)) }()
		<-keys.calls
		select {
		case err := <-started:
			t.Fatalf("the start returned while the re-wrap ran: %v", err)
		case <-time.After(50 * time.Millisecond):
		}
		close(keys.release)
		require.NoError(t, <-started)
	})
}

// TestLoadConfigErrorDefaults pins the error capture defaults of ADR 030
// Decision 5: the report location is on and the stack trace is off.
func TestLoadConfigErrorDefaults(t *testing.T) {
	t.Setenv("NEXTGEN_SERVER_DATA_DIR", t.TempDir())
	t.Setenv("NEXTGEN_INSTRUMENTATION_LOG_ERRORS_REPORT_LOCATION", "")
	t.Setenv("NEXTGEN_INSTRUMENTATION_LOG_ERRORS_STACK_TRACE", "")
	configPath := filepath.Join(t.TempDir(), "nextgen.yaml")
	require.NoError(t, os.WriteFile(configPath, nil, 0o600))

	cfg, err := loadConfig(configPath)
	require.NoError(t, err)
	assert.True(t, cfg.Instrumentation.Log.Errors.ReportLocation)
	assert.False(t, cfg.Instrumentation.Log.Errors.StackTrace)
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
	rehashed, err := hasher.VerifyAndRehash(legacy, password)
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

func TestLoadConfigReadsPlatformOperatorsFromEnv(t *testing.T) {
	t.Setenv("NEXTGEN_SERVER_DATA_DIR", t.TempDir())
	t.Setenv("NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT", "true")
	t.Setenv("NEXTGEN_PLATFORM_OPERATORS", "user_platformadmin,user_01H0000000000000000000000")

	configPath := filepath.Join(t.TempDir(), "nextgen.yaml")
	require.NoError(t, os.WriteFile(configPath, nil, 0o600))

	cfg, err := loadConfig(configPath)
	require.NoError(t, err)

	assert.Equal(t, []string{"user_platformadmin", "user_01H0000000000000000000000"}, cfg.Platform.Operators)
}

func TestLoadConfigReadsConsoleOriginsFromEnv(t *testing.T) {
	t.Setenv("NEXTGEN_SERVER_DATA_DIR", t.TempDir())
	t.Setenv("NEXTGEN_SERVER_CONSOLE_ORIGINS", "https://a.example.com,https://b.example.com")

	configPath := filepath.Join(t.TempDir(), "nextgen.yaml")
	require.NoError(t, os.WriteFile(configPath, nil, 0o600))

	cfg, err := loadConfig(configPath)
	require.NoError(t, err)

	assert.Equal(t, []string{"https://a.example.com", "https://b.example.com"}, cfg.Server.ConsoleOrigins)
}

// TestRunLogsTheErrorItReturns pins #1409. run's deferred "run error" record
// did not fire for the early returns that declare err in an if's scope, among
// them the bootstrap return this test drives, so such a failed start was only
// visible through main's log.Fatal, which slog.SetDefault bridges in at INFO.
// The failure here is the report's own, a data dir that was never migrated,
// and the record has to come out at ERROR, past a warn level, carrying the
// error run returns.
func TestRunLogsTheErrorItReturns(t *testing.T) {
	_, configPath := tempServerConfig(t)
	cfg, err := loadConfig(configPath)
	require.NoError(t, err)
	// Fails at a return that shadows err: the bootstrap needs the tables that
	// nothing created in this data dir.
	cfg.Platform.BootstrapProject = true
	cfg.Instrumentation.Log.Level = zlog.LevelWarning
	// With no format, setUpLogging builds on the slog default installed when
	// run starts, which is how its records land in the buffer below instead of
	// on stderr.
	cfg.Instrumentation.Log.Format = instrumentation.LogFormatUnspecified

	var records bytes.Buffer
	previous, previousOutput, previousFlags := slog.Default(), log.Writer(), log.Flags()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&records, nil)))
	// slog.SetDefault also points the log package at the new handler, and
	// reinstating a stdlib default does not point it back.
	t.Cleanup(func() {
		slog.SetDefault(previous)
		log.SetOutput(previousOutput)
		log.SetFlags(previousFlags)
	})

	// Bounded so that a start which no longer fails is reported instead of
	// waited on until go test's own timeout.
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	err = run(ctx, cfg, nil, false)
	require.ErrorContains(t, err, "failed to bootstrap platform project")

	var runError map[string]any
	for line := range strings.SplitSeq(strings.TrimSpace(records.String()), "\n") {
		var record map[string]any
		require.NoError(t, json.Unmarshal([]byte(line), &record), line)
		if record["msg"] == "run error" {
			runError = record
		}
	}
	require.NotNil(t, runError, "no \"run error\" record in:\n%s", records.String())
	assert.Equal(t, "ERROR", runError["level"])
	assert.Equal(t, err.Error(), runError["err"])
}
