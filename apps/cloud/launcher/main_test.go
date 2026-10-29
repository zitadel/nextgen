package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"

	"github.com/zitadel/nextgen/internal/audit"
)

const testPEM = "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu\n-----END RSA PRIVATE KEY-----\n"

const (
	pooledURL   = "postgresql://cloud-server.abc123:secret@eu-central.pg.psdb.cloud:6432/postgres?sslmode=verify-full&sslrootcert=system"
	migratorURL = "postgresql://cloud-migrator.abc123:secret@eu-central.pg.psdb.cloud:5432/postgres?sslmode=verify-full&sslrootcert=system"
	branch      = "claude/nextgen-deployment-plan-bd5396"
)

// setLauncherEnv gives every variable the launcher reads or writes a known
// value; t.Setenv restores the original after the test, including the ones
// the launcher sets itself.
func setLauncherEnv(t *testing.T, dataDir string) {
	t.Helper()
	for _, key := range []string{
		"BOOTSTRAP_ADMIN_USER_JSON_B64",
		"CLOUD_DATABASE_URL",
		"CLOUD_MIGRATOR_DATABASE_URL",
		"CLOUD_PRODUCTION_BRANCH",
		"MASTER_KEY_PREVIOUS_ID",
		"MASTER_KEY_PREVIOUS_PEM_B64",
		"NEXTGEN_DATABASE_POSTGRES",
		"NEXTGEN_INSTRUMENTATION_LOG_FORMAT",
		"NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT",
		"NEXTGEN_PLATFORM_OPERATORS",
		"NEXTGEN_SERVER_ADDRESS",
		"NEXTGEN_SERVER_CONSOLE_ENABLED",
		"NEXTGEN_SERVER_CONSOLE_ORIGINS",
		"NEXTGEN_SERVER_CONSOLE_PATH",
		"NEXTGEN_SERVER_PUBLIC_BASE",
		"NEXTGEN_SERVER_REQUEST_ID_HEADER",
		"PORT",
		"VERCEL_BRANCH_URL",
		"VERCEL_ENV",
		"VERCEL_GIT_COMMIT_REF",
		"VERCEL_PROJECT_PRODUCTION_URL",
		"VERCEL_URL",
	} {
		t.Setenv(key, "")
	}
	t.Setenv("NEXTGEN_SERVER_DATA_DIR", dataDir)
	t.Setenv("MASTER_KEY_PEM_B64", base64.StdEncoding.EncodeToString([]byte(testPEM)))
	t.Setenv("MASTER_KEY_ID", "cloud-2026-10")
	// Every deployment has one; a case about a local run clears it.
	t.Setenv("CRON_SECRET", testCronSecret)
}

const testCronSecret = "0123456789abcdef-cron"

type ensureCall struct {
	baseDSN, name, ref string
}

// stubEnsureDatabase records the preview databases the launcher asks for
// instead of connecting anywhere.
func stubEnsureDatabase(t *testing.T) *[]ensureCall {
	t.Helper()
	calls := &[]ensureCall{}
	previous := ensureDatabase
	ensureDatabase = func(_ context.Context, baseDSN, name, ref string, _ time.Time) error {
		*calls = append(*calls, ensureCall{baseDSN, name, ref})
		return nil
	}
	t.Cleanup(func() { ensureDatabase = previous })
	return calls
}

func previewName(t *testing.T) string {
	t.Helper()
	name, err := previewDatabaseName(branch)
	require.NoError(t, err)
	return name
}

func TestPrepareServerRendersTheMasterKeyIntoTheConfig(t *testing.T) {
	dataDir := t.TempDir()
	setLauncherEnv(t, dataDir)
	t.Setenv("PORT", "9090")
	// A local run has no cron job, so the server keeps its own purge loop.
	t.Setenv("CRON_SECRET", "")

	args, err := prepareServer(nil)
	require.NoError(t, err)

	configPath := filepath.Join(dataDir, "nextgen.yaml")
	assert.Equal(t, []string{"server", "--config", configPath, "--migrate"}, args, "a local run migrates its own database")

	config, err := os.ReadFile(configPath)
	require.NoError(t, err)
	assert.Equal(t, "server:\n"+
		"  generate_master_key: false\n"+
		"  master_keys:\n"+
		"    cloud-2026-10:\n"+
		"      use_for_encryption: true\n"+
		"      private_key: |\n"+
		"        -----BEGIN RSA PRIVATE KEY-----\n"+
		"        MIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu\n"+
		"        -----END RSA PRIVATE KEY-----\n", string(config))
	info, err := os.Stat(configPath)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o600), info.Mode().Perm())

	assert.Equal(t, ":9090", os.Getenv("NEXTGEN_SERVER_ADDRESS"), "the listen address follows Vercel's PORT")
	assert.Empty(t, os.Getenv("MASTER_KEY_PEM_B64"), "the secret leaves the environment once it is on disk")
	assert.NoDirExists(t, filepath.Join(dataDir, "master-keys"), "nothing is written where the server adopts keys from")
}

func TestPrepareServerNormalizesThePEM(t *testing.T) {
	dataDir := t.TempDir()
	setLauncherEnv(t, dataDir)
	// Pasted keys arrive with carriage returns, blank lines and indentation.
	t.Setenv("MASTER_KEY_PEM_B64", base64.StdEncoding.EncodeToString([]byte(
		"  -----BEGIN RSA PRIVATE KEY-----\r\n\r\n   MIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu\r\n-----END RSA PRIVATE KEY-----\r\n")))

	_, err := prepareServer(nil)
	require.NoError(t, err)

	config, err := os.ReadFile(filepath.Join(dataDir, "nextgen.yaml"))
	require.NoError(t, err)
	assert.Contains(t, string(config), "        -----BEGIN RSA PRIVATE KEY-----\n        MIIBOg")
	assert.NotContains(t, string(config), "\r")
	assert.Equal(t, ":8080", os.Getenv("NEXTGEN_SERVER_ADDRESS"), "PORT defaults to 8080")
}

// A rotation configures the key being rotated out for decryption only; the
// server re-wraps what it wrapped at startup.
func TestPrepareServerRendersThePreviousMasterKeyForDecryption(t *testing.T) {
	dataDir := t.TempDir()
	setLauncherEnv(t, dataDir)
	t.Setenv("CRON_SECRET", "")
	const previousPEM = "-----BEGIN RSA PRIVATE KEY-----\nOLDKEY\n-----END RSA PRIVATE KEY-----\n"
	t.Setenv("MASTER_KEY_PREVIOUS_PEM_B64", base64.StdEncoding.EncodeToString([]byte(previousPEM)))
	t.Setenv("MASTER_KEY_PREVIOUS_ID", "cloud-2026-09")

	_, err := prepareServer(nil)
	require.NoError(t, err)

	config, err := os.ReadFile(filepath.Join(dataDir, "nextgen.yaml"))
	require.NoError(t, err)
	assert.Equal(t, "server:\n"+
		"  generate_master_key: false\n"+
		"  master_keys:\n"+
		"    cloud-2026-10:\n"+
		"      use_for_encryption: true\n"+
		"      private_key: |\n"+
		"        -----BEGIN RSA PRIVATE KEY-----\n"+
		"        MIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu\n"+
		"        -----END RSA PRIVATE KEY-----\n"+
		"    cloud-2026-09:\n"+
		"      use_for_encryption: false\n"+
		"      private_key: |\n"+
		"        -----BEGIN RSA PRIVATE KEY-----\n"+
		"        OLDKEY\n"+
		"        -----END RSA PRIVATE KEY-----\n", string(config))
	assert.Empty(t, os.Getenv("MASTER_KEY_PREVIOUS_PEM_B64"), "the previous key leaves the environment too")
}

func TestPrepareServerServesProductionFromThePooledURL(t *testing.T) {
	setLauncherEnv(t, t.TempDir())
	t.Setenv("VERCEL_ENV", "production")
	t.Setenv("CLOUD_DATABASE_URL", pooledURL)
	t.Setenv("CLOUD_MIGRATOR_DATABASE_URL", migratorURL)

	_, err := prepareServer(nil)
	require.NoError(t, err)

	served, err := url.Parse(os.Getenv("NEXTGEN_DATABASE_POSTGRES"))
	require.NoError(t, err)
	assert.Equal(t, "eu-central.pg.psdb.cloud:6432", served.Host, "the pooler, never the direct port")
	assert.Equal(t, "cloud-server.abc123", served.User.Username())
	assert.Equal(t, "/postgres", served.Path, "production serves the database it is given")
	assert.Equal(t, url.Values{
		"sslmode":                 {"verify-full"},
		"sslrootcert":             {"system"},
		"pool_max_conns":          {"4"},
		"default_query_exec_mode": {"cache_describe"},
	}, served.Query())
}

// A function runs only while it serves a request, so the server's own purge
// loop cannot run here: the cron job in vercel.json calls the server's
// trigger with CRON_SECRET, which the server takes from the config file.
func TestPrepareServerLeavesThePurgeToTheCronJob(t *testing.T) {
	dataDir := t.TempDir()
	setLauncherEnv(t, dataDir)
	t.Setenv("VERCEL_ENV", "production")
	t.Setenv("CLOUD_DATABASE_URL", pooledURL)
	// A quote is the one character the YAML string has to escape.
	const secret = "0123456789'abcdef"
	t.Setenv("CRON_SECRET", secret)

	_, err := prepareServer(nil)
	require.NoError(t, err)

	raw, err := os.ReadFile(filepath.Join(dataDir, "nextgen.yaml"))
	require.NoError(t, err)
	var config struct {
		Events struct {
			Retention struct {
				TriggerSecret string `yaml:"trigger_secret"`
			} `yaml:"retention"`
		} `yaml:"events"`
	}
	require.NoError(t, yaml.Unmarshal(raw, &config))
	assert.Equal(t, secret, config.Events.Retention.TriggerSecret)
	assert.Empty(t, os.Getenv("CRON_SECRET"), "the secret leaves the environment once it is on disk")
}

func TestPrepareServerServesAPreviewFromItsOwnDatabase(t *testing.T) {
	setLauncherEnv(t, t.TempDir())
	t.Setenv("VERCEL_ENV", "preview")
	t.Setenv("VERCEL_GIT_COMMIT_REF", branch)
	t.Setenv("CLOUD_DATABASE_URL", pooledURL)

	_, err := prepareServer(nil)
	require.NoError(t, err)

	served, err := url.Parse(os.Getenv("NEXTGEN_DATABASE_POSTGRES"))
	require.NoError(t, err)
	assert.Equal(t, "eu-central.pg.psdb.cloud:6432", served.Host)
	assert.Equal(t, "/"+previewName(t), served.Path, "the branch's database, not the cluster's base database")
	assert.Equal(t, "4", served.Query().Get("pool_max_conns"))
}

func TestPreviewDatabaseName(t *testing.T) {
	name := previewName(t)
	assert.Regexp(t, `^preview_claude_nextgen_deployment_plan_bd5396_[0-9a-f]{8}$`, name)

	again, err := previewDatabaseName(branch)
	require.NoError(t, err)
	assert.Equal(t, name, again, "every build and every function of a branch agree")

	long := "feature/" + strings.Repeat("a-very-long-branch-name-", 4)
	first, err := previewDatabaseName(long + "one")
	require.NoError(t, err)
	second, err := previewDatabaseName(long + "two")
	require.NoError(t, err)
	assert.NotEqual(t, first, second, "the hash keeps branches apart where the readable part is cut")
	assert.LessOrEqual(t, len(first), 63, "Postgres identifiers hold 63 bytes")

	odd, err := previewDatabaseName("---")
	require.NoError(t, err)
	assert.Regexp(t, `^preview_[0-9a-f]{8}$`, odd)

	_, err = previewDatabaseName("")
	assert.ErrorContains(t, err, "needs its Git branch")
}

func TestWithDatabaseKeepsCredentialsAndParameters(t *testing.T) {
	dsn, err := withDatabase(migratorURL, "preview_x_0000")
	require.NoError(t, err)
	assert.Equal(t, "postgresql://cloud-migrator.abc123:secret@eu-central.pg.psdb.cloud:5432/preview_x_0000?sslmode=verify-full&sslrootcert=system", dsn)

	_, err = withDatabase("host=db user=u", "x")
	assert.ErrorContains(t, err, "postgres:// or postgresql://")
}

func TestWithParamsKeepsWhatTheURLAlreadySets(t *testing.T) {
	dsn, err := withParams("postgres://u:p@host/db?pool_max_conns=10&sslmode=verify-full", servingParams)
	require.NoError(t, err)

	parsed, err := url.Parse(dsn)
	require.NoError(t, err)
	assert.Equal(t, "10", parsed.Query().Get("pool_max_conns"), "an explicit pool size wins")
	assert.Equal(t, "verify-full", parsed.Query().Get("sslmode"))
	assert.Equal(t, "cache_describe", parsed.Query().Get("default_query_exec_mode"))
}

func TestPrepareServerPinsTheDeploymentShape(t *testing.T) {
	setLauncherEnv(t, t.TempDir())
	t.Setenv("VERCEL_ENV", "production")
	t.Setenv("CLOUD_DATABASE_URL", pooledURL)
	t.Setenv("VERCEL_PROJECT_PRODUCTION_URL", "nextgen-preview-cloud.vercel.app")
	// Leftovers from an earlier layout must not move the console.
	t.Setenv("NEXTGEN_SERVER_CONSOLE_ENABLED", "true")
	t.Setenv("NEXTGEN_SERVER_CONSOLE_PATH", "/ui/console")
	t.Setenv("NEXTGEN_SERVER_REQUEST_ID_HEADER", "x-request-id")

	_, err := prepareServer(nil)
	require.NoError(t, err)

	assert.Equal(t, "false", os.Getenv("NEXTGEN_SERVER_CONSOLE_ENABLED"), "the console is a service of its own")
	assert.Equal(t, "/console", os.Getenv("NEXTGEN_SERVER_CONSOLE_PATH"), "where vercel.json mounts the console")
	assert.Equal(t, "x-vercel-id", os.Getenv("NEXTGEN_SERVER_REQUEST_ID_HEADER"), "the ID Vercel's dashboard shows")
	assert.Equal(t, "true", os.Getenv("NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT"))
	assert.Equal(t, "json", os.Getenv("NEXTGEN_INSTRUMENTATION_LOG_FORMAT"))
	assert.Equal(t, "https://nextgen-preview-cloud.vercel.app", os.Getenv("NEXTGEN_SERVER_PUBLIC_BASE"))
	assert.Equal(t, "https://nextgen-preview-cloud.vercel.app", os.Getenv("NEXTGEN_SERVER_CONSOLE_ORIGINS"))
}

// vercel.json mounts the console service, and builds it, at the path the
// server's console links point to; JSON has no comments to say so.
func TestVercelJSONServesTheConsoleAtConsolePath(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "vercel.json"))
	require.NoError(t, err)
	var config struct {
		Services map[string]struct {
			BuildCommand string `json:"buildCommand"`
			Rewrites     []struct {
				Source      string `json:"source"`
				Destination string `json:"destination"`
			} `json:"rewrites"`
		} `json:"services"`
		Rewrites []struct {
			Source      string          `json:"source"`
			Destination json.RawMessage `json:"destination"`
		} `json:"rewrites"`
	}
	require.NoError(t, json.Unmarshal(raw, &config))

	console := config.Services["console"]
	assert.Contains(t, console.BuildCommand, "CONSOLE_BASE_PATH="+consolePath+"/ ", "the base the console is built for")
	// The service receives the request's full path; its first rewrite maps
	// the mount onto the build's own root.
	require.NotEmpty(t, console.Rewrites)
	assert.Equal(t, consolePath+"/:path(.*)? → /:path", console.Rewrites[0].Source+" → "+console.Rewrites[0].Destination,
		"where the console service serves the build from")

	// The first matching rewrite wins, and the server's runtime document
	// (cmd/server/console_runtime.go) lies under the console's mount.
	var routes []string
	for _, rewrite := range config.Rewrites {
		var destination struct{ Service string }
		if json.Unmarshal(rewrite.Destination, &destination) != nil {
			continue
		}
		if rewrite.Source == "/console/runtime.json" || strings.HasPrefix(rewrite.Source, consolePath+"/") {
			routes = append(routes, rewrite.Source+" → "+destination.Service)
		}
	}
	assert.Equal(t, []string{"/console/runtime.json → server", consolePath + "/(.*) → console"}, routes)
}

// The other services' functions run in the project-wide regions; the server
// stays beside its database in Frankfurt. @vercel/go matches a functions key
// against the entrypoint's path and silently ignores one that does not match.
func TestVercelJSONKeepsTheServerInFrankfurt(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "vercel.json"))
	require.NoError(t, err)
	var config struct {
		Services map[string]struct {
			Entrypoint string `json:"entrypoint"`
			Functions  map[string]struct {
				Regions []string `json:"regions"`
			} `json:"functions"`
		} `json:"services"`
	}
	require.NoError(t, json.Unmarshal(raw, &config))

	server := config.Services["server"]
	require.Len(t, server.Functions, 1)
	function, ok := server.Functions[server.Entrypoint]
	require.True(t, ok, "the server's functions key is its entrypoint, %q", server.Entrypoint)
	assert.Equal(t, []string{"fra1"}, function.Regions, "the region of the PlanetScale databases")
}

// The cron job is the only caller of the audit event purge in the cloud, so
// its path is the server's trigger, and nothing routes it anywhere but the
// server: a redirect would end the run, which a cron job does not follow, and
// another service would answer 404.
func TestVercelJSONSchedulesTheEventRetentionPurge(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "vercel.json"))
	require.NoError(t, err)
	var config struct {
		Crons []struct {
			Path     string `json:"path"`
			Schedule string `json:"schedule"`
		} `json:"crons"`
		Redirects []struct {
			Source string `json:"source"`
		} `json:"redirects"`
		Rewrites []struct {
			Source      string          `json:"source"`
			Destination json.RawMessage `json:"destination"`
		} `json:"rewrites"`
	}
	require.NoError(t, json.Unmarshal(raw, &config))

	require.Len(t, config.Crons, 1)
	assert.Equal(t, audit.RetentionTriggerPath, config.Crons[0].Path)
	assert.Equal(t, "17 * * * *", config.Crons[0].Schedule, "hourly, as a self-hosted server purges")

	for _, redirect := range config.Redirects {
		assert.False(t, routeMatches(redirect.Source, audit.RetentionTriggerPath), "redirected by %s", redirect.Source)
	}
	var service string
	for _, rewrite := range config.Rewrites {
		if routeMatches(rewrite.Source, audit.RetentionTriggerPath) {
			var destination struct{ Service string }
			require.NoError(t, json.Unmarshal(rewrite.Destination, &destination))
			service = destination.Service
			break
		}
	}
	assert.Equal(t, "server", service, "the first rewrite that matches the trigger's path")
}

// routeMatches reports whether a vercel.json source matches path, for the
// forms the file uses: literal paths, (.*) and a named :param(.*).
func routeMatches(source, path string) bool {
	pattern := strings.ReplaceAll(regexp.QuoteMeta(source), `\(\.\*\)\?`, `(.*)`)
	pattern = strings.ReplaceAll(pattern, `\(\.\*\)`, `(.*)`)
	pattern = regexp.MustCompile(`:\w+`).ReplaceAllString(pattern, "")
	return regexp.MustCompile("^" + pattern + "$").MatchString(path)
}

// The console service builds into the server's embed directory in the same
// checkout, so the function is compiled without it; a plain build would
// carry the console whenever that service built first.
func TestBuildScriptLeavesTheConsoleOut(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "build-launcher.sh"))
	require.NoError(t, err)
	var builds []string
	for _, line := range strings.Split(string(raw), "\n") {
		if strings.Contains(line, "go build") && !strings.HasPrefix(strings.TrimSpace(line), "#") {
			builds = append(builds, line)
		}
	}
	require.Len(t, builds, 1, "build-launcher.sh compiles the function once")
	assert.Contains(t, builds[0], "-tags noconsole")
}

func TestPrepareServerKeepsExplicitDefaults(t *testing.T) {
	setLauncherEnv(t, t.TempDir())
	t.Setenv("VERCEL_ENV", "production")
	t.Setenv("CLOUD_DATABASE_URL", pooledURL)
	t.Setenv("VERCEL_PROJECT_PRODUCTION_URL", "nextgen-preview-cloud.vercel.app")
	t.Setenv("NEXTGEN_SERVER_PUBLIC_BASE", "https://cloud.example.com")
	t.Setenv("NEXTGEN_INSTRUMENTATION_LOG_FORMAT", "text")

	_, err := prepareServer(nil)
	require.NoError(t, err)

	assert.Equal(t, "https://cloud.example.com", os.Getenv("NEXTGEN_SERVER_PUBLIC_BASE"))
	assert.Equal(t, "text", os.Getenv("NEXTGEN_INSTRUMENTATION_LOG_FORMAT"))
}

func TestConsoleOrigins(t *testing.T) {
	setLauncherEnv(t, t.TempDir())
	t.Setenv("VERCEL_URL", "nextgen-preview-cloud-abc123-zitadel.vercel.app")
	t.Setenv("VERCEL_BRANCH_URL", "nextgen-preview-cloud-git-feature-zitadel.vercel.app")

	assert.Equal(t,
		"https://nextgen-preview-cloud-abc123-zitadel.vercel.app,https://nextgen-preview-cloud-git-feature-zitadel.vercel.app",
		consoleOrigins(), "a preview serves the console on its own URL and its branch's")

	t.Setenv("VERCEL_URL", "")
	t.Setenv("VERCEL_BRANCH_URL", "")
	assert.Empty(t, consoleOrigins(), "a local run names none")
}

func TestPublicBase(t *testing.T) {
	setLauncherEnv(t, t.TempDir())
	t.Setenv("VERCEL_PROJECT_PRODUCTION_URL", "nextgen-preview-cloud.vercel.app")
	t.Setenv("VERCEL_BRANCH_URL", "nextgen-preview-cloud-git-feature-zitadel.vercel.app")
	t.Setenv("VERCEL_URL", "nextgen-preview-cloud-abc123-zitadel.vercel.app")

	assert.Equal(t, "https://nextgen-preview-cloud.vercel.app", publicBase("production"))
	assert.Equal(t, "https://nextgen-preview-cloud-git-feature-zitadel.vercel.app", publicBase("preview"), "a preview keeps its branch's stable URL")
	assert.Equal(t, "https://nextgen-preview-cloud-abc123-zitadel.vercel.app", publicBase("development"))

	t.Setenv("VERCEL_BRANCH_URL", "")
	assert.Equal(t, "https://nextgen-preview-cloud-abc123-zitadel.vercel.app", publicBase("preview"))

	t.Setenv("VERCEL_URL", "")
	assert.Empty(t, publicBase(""), "a local run keeps the server's default")
}

func TestPrepareServerRendersTheBootstrapAdminDocument(t *testing.T) {
	dataDir := t.TempDir()
	setLauncherEnv(t, dataDir)
	doc := `{"header":{"version":1,"id":"user_platformadmin"},"authenticators":{}}`
	t.Setenv("BOOTSTRAP_ADMIN_USER_JSON_B64", base64.StdEncoding.EncodeToString([]byte(doc)))

	args, err := prepareServer([]string{"--disable-master-key-generation"})
	require.NoError(t, err)

	adminPath := filepath.Join(dataDir, "admin-user.json")
	assert.Equal(t, []string{"server", "--config", filepath.Join(dataDir, "nextgen.yaml"), "--migrate", "--user-file", adminPath, "--disable-master-key-generation"}, args)
	written, err := os.ReadFile(adminPath)
	require.NoError(t, err)
	assert.Equal(t, doc, string(written))
	assert.Empty(t, os.Getenv("BOOTSTRAP_ADMIN_USER_JSON_B64"))
}

func TestPrepareServerMakesTheBootstrapAdminAnOperator(t *testing.T) {
	setLauncherEnv(t, t.TempDir())
	doc := `{"header":{"version":1,"project_id":"proj_platform","id":"user_platformadmin"},"authenticators":{}}`
	t.Setenv("BOOTSTRAP_ADMIN_USER_JSON_B64", base64.StdEncoding.EncodeToString([]byte(doc)))

	_, err := prepareServer(nil)
	require.NoError(t, err)
	assert.Equal(t, "user_platformadmin", os.Getenv("NEXTGEN_PLATFORM_OPERATORS"))
}

func TestPrepareServerKeepsConfiguredOperators(t *testing.T) {
	setLauncherEnv(t, t.TempDir())
	doc := `{"header":{"version":1,"id":"user_platformadmin"},"authenticators":{}}`
	t.Setenv("BOOTSTRAP_ADMIN_USER_JSON_B64", base64.StdEncoding.EncodeToString([]byte(doc)))
	t.Setenv("NEXTGEN_PLATFORM_OPERATORS", "user_support")

	_, err := prepareServer(nil)
	require.NoError(t, err)
	assert.Equal(t, "user_support", os.Getenv("NEXTGEN_PLATFORM_OPERATORS"))
}

func TestPrepareServerNamesNoOperatorWithoutABootstrapAdmin(t *testing.T) {
	setLauncherEnv(t, t.TempDir())

	_, err := prepareServer(nil)
	require.NoError(t, err)
	assert.Empty(t, os.Getenv("NEXTGEN_PLATFORM_OPERATORS"))
}

func TestPrepareServerLocallyKeepsTheConfiguredDatabase(t *testing.T) {
	setLauncherEnv(t, t.TempDir())
	t.Setenv("NEXTGEN_DATABASE_POSTGRES", "postgres://local/db")

	_, err := prepareServer(nil)
	require.NoError(t, err)

	assert.Equal(t, "postgres://local/db", os.Getenv("NEXTGEN_DATABASE_POSTGRES"), "without CLOUD_DATABASE_URL a local run keeps its own database")
}

// Only a local run serving its own database migrates when it starts: no build
// step ran for it. A deployment, or a local run against a cloud database,
// never changes a schema by starting.
func TestPrepareServerMigratesOnlyALocalRunsOwnDatabase(t *testing.T) {
	for _, tc := range []struct {
		name, env, databaseURL string
		migrates               bool
	}{
		{name: "by hand", env: "", migrates: true},
		{name: "vercel dev", env: "development", migrates: true},
		{name: "local against a cloud database", env: "", databaseURL: pooledURL},
		{name: "preview", env: "preview", databaseURL: pooledURL},
		{name: "production", env: "production", databaseURL: pooledURL},
	} {
		t.Run(tc.name, func(t *testing.T) {
			setLauncherEnv(t, t.TempDir())
			t.Setenv("VERCEL_ENV", tc.env)
			t.Setenv("VERCEL_GIT_COMMIT_REF", branch)
			t.Setenv("CLOUD_DATABASE_URL", tc.databaseURL)

			args, err := prepareServer(nil)
			require.NoError(t, err)

			assert.Equal(t, tc.migrates, slices.Contains(args, "--migrate"), "args: %q", args)
		})
	}
}

func TestPrepareServerRefusesBadInput(t *testing.T) {
	cases := map[string]func(t *testing.T){
		"--migrate so a serving function can never change the schema": func(t *testing.T) {
			_, err := prepareServer([]string{"--migrate"})
			assert.ErrorContains(t, err, "refusing --migrate")
			_, err = prepareServer([]string{"--migrate=true"})
			assert.ErrorContains(t, err, "refusing --migrate")
		},
		"a missing master key": func(t *testing.T) {
			t.Setenv("MASTER_KEY_PEM_B64", "")
			_, err := prepareServer(nil)
			assert.ErrorContains(t, err, "MASTER_KEY_PEM_B64 must be set")
		},
		"a key that is not a PEM block": func(t *testing.T) {
			t.Setenv("MASTER_KEY_PEM_B64", base64.StdEncoding.EncodeToString([]byte("not a key")))
			_, err := prepareServer(nil)
			assert.ErrorContains(t, err, "does not decode to a PEM block")
		},
		"a missing key id, which would orphan the wrapped keys on the next change": func(t *testing.T) {
			t.Setenv("MASTER_KEY_ID", "")
			_, err := prepareServer(nil)
			assert.ErrorContains(t, err, "MASTER_KEY_ID must be set")
		},
		"a key id that cannot be written into YAML unquoted": func(t *testing.T) {
			t.Setenv("MASTER_KEY_ID", "bad id:")
			_, err := prepareServer(nil)
			assert.ErrorContains(t, err, "MASTER_KEY_ID must be set and match")
		},
		"a deployment without a database, which would silently serve from SQLite in /tmp": func(t *testing.T) {
			for _, env := range []string{"production", "preview"} {
				t.Setenv("VERCEL_ENV", env)
				_, err := prepareServer(nil)
				assert.ErrorContains(t, err, "CLOUD_DATABASE_URL must be set for a "+env+" deployment")
			}
		},
		"a preview that does not know its branch": func(t *testing.T) {
			t.Setenv("VERCEL_ENV", "preview")
			t.Setenv("CLOUD_DATABASE_URL", pooledURL)
			_, err := prepareServer(nil)
			assert.ErrorContains(t, err, "needs its Git branch")
		},
		"a bootstrap admin document without a user id, which would start the cloud without an operator": func(t *testing.T) {
			t.Setenv("BOOTSTRAP_ADMIN_USER_JSON_B64", base64.StdEncoding.EncodeToString([]byte(`{"header":{"version":1},"authenticators":{}}`)))
			_, err := prepareServer(nil)
			assert.ErrorContains(t, err, "names no user id")
		},
		"a bootstrap admin document that does not decode": func(t *testing.T) {
			t.Setenv("BOOTSTRAP_ADMIN_USER_JSON_B64", base64.StdEncoding.EncodeToString([]byte(`{"header":"x","authenticators":{}}`)))
			_, err := prepareServer(nil)
			assert.ErrorContains(t, err, "does not decode to a bootstrap user document")
		},
		"a database URL that is not a postgres URL": func(t *testing.T) {
			t.Setenv("CLOUD_DATABASE_URL", "host=db user=u")
			_, err := prepareServer(nil)
			assert.ErrorContains(t, err, "must be postgres:// or postgresql:// URLs")
		},
		"a previous key without its id, or the reverse": func(t *testing.T) {
			t.Setenv("MASTER_KEY_PREVIOUS_PEM_B64", base64.StdEncoding.EncodeToString([]byte(testPEM)))
			_, err := prepareServer(nil)
			assert.ErrorContains(t, err, "MASTER_KEY_PREVIOUS_PEM_B64 and MASTER_KEY_PREVIOUS_ID go together")
			t.Setenv("MASTER_KEY_PREVIOUS_PEM_B64", "")
			t.Setenv("MASTER_KEY_PREVIOUS_ID", "cloud-2026-09")
			_, err = prepareServer(nil)
			assert.ErrorContains(t, err, "go together")
		},
		"a previous key that is the current one": func(t *testing.T) {
			t.Setenv("MASTER_KEY_PREVIOUS_PEM_B64", base64.StdEncoding.EncodeToString([]byte(testPEM)))
			t.Setenv("MASTER_KEY_PREVIOUS_ID", "cloud-2026-10")
			_, err := prepareServer(nil)
			assert.ErrorContains(t, err, `MASTER_KEY_PREVIOUS_ID "cloud-2026-10" is the current key's id`)
		},
		"a previous key that is not a PEM block": func(t *testing.T) {
			t.Setenv("MASTER_KEY_PREVIOUS_PEM_B64", base64.StdEncoding.EncodeToString([]byte("not a key")))
			t.Setenv("MASTER_KEY_PREVIOUS_ID", "cloud-2026-09")
			_, err := prepareServer(nil)
			assert.ErrorContains(t, err, "MASTER_KEY_PREVIOUS_PEM_B64 does not decode to a PEM block")
		},
		"a bootstrap document that is not one": func(t *testing.T) {
			t.Setenv("BOOTSTRAP_ADMIN_USER_JSON_B64", base64.StdEncoding.EncodeToString([]byte(`{"user":"x"}`)))
			_, err := prepareServer(nil)
			assert.ErrorContains(t, err, "does not decode to a bootstrap user document")
		},
		"a deployment without a cron secret, which would never purge expired audit events": func(t *testing.T) {
			t.Setenv("CLOUD_DATABASE_URL", pooledURL)
			t.Setenv("VERCEL_GIT_COMMIT_REF", branch)
			t.Setenv("CRON_SECRET", "")
			for _, env := range []string{"production", "preview"} {
				t.Setenv("VERCEL_ENV", env)
				_, err := prepareServer(nil)
				assert.ErrorContains(t, err, "CRON_SECRET must be set for a "+env+" deployment")
			}
		},
		"a cron secret short enough to guess": func(t *testing.T) {
			t.Setenv("CRON_SECRET", "0123456789")
			_, err := prepareServer(nil)
			assert.ErrorContains(t, err, "CRON_SECRET must be at least 16 printable ASCII characters")
		},
	}
	for name, check := range cases {
		t.Run(name, func(t *testing.T) {
			setLauncherEnv(t, t.TempDir())
			check(t)
		})
	}
}

func TestPrepareMigrationCreatesAndMigratesAPreviewDatabase(t *testing.T) {
	calls := stubEnsureDatabase(t)
	setLauncherEnv(t, "")
	t.Setenv("VERCEL_ENV", "preview")
	t.Setenv("VERCEL_GIT_COMMIT_REF", branch)
	t.Setenv("CLOUD_DATABASE_URL", pooledURL)
	t.Setenv("CLOUD_MIGRATOR_DATABASE_URL", migratorURL)

	args, err := prepareMigration(nil)
	require.NoError(t, err)

	assert.Equal(t, []string{"migrate"}, args)
	assert.Equal(t, []ensureCall{{migratorURL, previewName(t), branch}}, *calls,
		"the database is created through the base database of the preview cluster")
	migrated, err := url.Parse(os.Getenv("NEXTGEN_DATABASE_POSTGRES"))
	require.NoError(t, err)
	assert.Equal(t, "eu-central.pg.psdb.cloud:5432", migrated.Host, "the migration lock needs a session, which the pooler cannot hold")
	assert.Equal(t, "/"+previewName(t), migrated.Path)
	assert.Equal(t, defaultDataDir, os.Getenv("NEXTGEN_SERVER_DATA_DIR"))
}

func TestShouldRecreatePreviewOnMigrateError(t *testing.T) {
	assert.False(t, shouldRecreatePreviewOnMigrateError(nil))
	assert.False(t, shouldRecreatePreviewOnMigrateError(assert.AnError))
	assert.True(t, shouldRecreatePreviewOnMigrateError(fmt.Errorf(
		"unknown database error: detected 2 missing (out-of-order) migrations lower than database version (37): versions 34,35")))
	assert.True(t, shouldRecreatePreviewOnMigrateError(fmt.Errorf(
		"detected 1 missing (out-of-order) migration lower than database version (3): version 2")))
	assert.True(t, shouldRecreatePreviewOnMigrateError(fmt.Errorf(
		`launcher: unknown database error: ERROR: column "deployment_id" of relation "auth_attempts" already exists (SQLSTATE 42701)`)))
}

func TestRunMigrateRecreatesPreviewOnOutOfOrder(t *testing.T) {
	ensureCalls := stubEnsureDatabase(t)
	var dropped []string
	previousDrop := dropDatabase
	dropDatabase = func(_ context.Context, _, name string) error {
		dropped = append(dropped, name)
		return nil
	}
	t.Cleanup(func() { dropDatabase = previousDrop })

	attempts := 0
	previousExec := executeServer
	executeServer = func([]string) error {
		attempts++
		if attempts == 1 {
			return fmt.Errorf("detected 2 missing (out-of-order) migrations lower than database version (37): versions 34,35")
		}
		return nil
	}
	t.Cleanup(func() { executeServer = previousExec })

	setLauncherEnv(t, "")
	t.Setenv("VERCEL_ENV", "preview")
	t.Setenv("VERCEL_GIT_COMMIT_REF", branch)
	t.Setenv("CLOUD_DATABASE_URL", pooledURL)
	t.Setenv("CLOUD_MIGRATOR_DATABASE_URL", migratorURL)

	require.NoError(t, runMigrate(nil))
	assert.Equal(t, 2, attempts)
	assert.Equal(t, []string{previewName(t)}, dropped)
	assert.Len(t, *ensureCalls, 2, "ensure runs before each migrate attempt")
}

func TestRunMigrateRecreatesPreviewOnDuplicateColumn(t *testing.T) {
	ensureCalls := stubEnsureDatabase(t)
	var dropped []string
	previousDrop := dropDatabase
	dropDatabase = func(_ context.Context, _, name string) error {
		dropped = append(dropped, name)
		return nil
	}
	t.Cleanup(func() { dropDatabase = previousDrop })

	attempts := 0
	previousExec := executeServer
	executeServer = func([]string) error {
		attempts++
		if attempts == 1 {
			return fmt.Errorf(`unknown database error: ERROR: column "deployment_id" of relation "auth_attempts" already exists (SQLSTATE 42701)`)
		}
		return nil
	}
	t.Cleanup(func() { executeServer = previousExec })

	setLauncherEnv(t, "")
	t.Setenv("VERCEL_ENV", "preview")
	t.Setenv("VERCEL_GIT_COMMIT_REF", branch)
	t.Setenv("CLOUD_DATABASE_URL", pooledURL)
	t.Setenv("CLOUD_MIGRATOR_DATABASE_URL", migratorURL)

	require.NoError(t, runMigrate(nil))
	assert.Equal(t, 2, attempts)
	assert.Equal(t, []string{previewName(t)}, dropped)
	assert.Len(t, *ensureCalls, 2)
}

func TestRunMigrateDoesNotDropProductionOnOutOfOrder(t *testing.T) {
	ensureCalls := stubEnsureDatabase(t)
	var dropped int
	previousDrop := dropDatabase
	dropDatabase = func(context.Context, string, string) error {
		dropped++
		return nil
	}
	t.Cleanup(func() { dropDatabase = previousDrop })

	previousExec := executeServer
	executeServer = func([]string) error {
		return fmt.Errorf("detected 1 missing (out-of-order) migration lower than database version (3): version 2")
	}
	t.Cleanup(func() { executeServer = previousExec })

	setLauncherEnv(t, t.TempDir())
	t.Setenv("VERCEL_ENV", "production")
	t.Setenv("VERCEL_GIT_COMMIT_REF", "main")
	t.Setenv("CLOUD_DATABASE_URL", pooledURL)
	t.Setenv("CLOUD_MIGRATOR_DATABASE_URL", migratorURL)

	err := runMigrate(nil)
	require.Error(t, err)
	assert.Zero(t, dropped)
	assert.Empty(t, *ensureCalls, "production creates no preview database")
}

func TestPrepareMigrationMigratesProductionInPlace(t *testing.T) {
	calls := stubEnsureDatabase(t)
	setLauncherEnv(t, t.TempDir())
	t.Setenv("VERCEL_ENV", "production")
	t.Setenv("VERCEL_GIT_COMMIT_REF", "main")
	t.Setenv("CLOUD_DATABASE_URL", pooledURL)
	t.Setenv("CLOUD_MIGRATOR_DATABASE_URL", migratorURL)

	_, err := prepareMigration(nil)
	require.NoError(t, err)

	assert.Empty(t, *calls, "production creates no database")
	assert.Equal(t, migratorURL, os.Getenv("NEXTGEN_DATABASE_POSTGRES"))
	assert.NoFileExists(t, filepath.Join(os.Getenv("NEXTGEN_SERVER_DATA_DIR"), "nextgen.yaml"), "the build only parses the function's configuration")
}

func TestPrepareMigrationRefusesWhatTheFunctionWouldRefuse(t *testing.T) {
	cases := map[string]struct {
		set    map[string]string
		reason string
	}{
		"a missing master key":          {map[string]string{"MASTER_KEY_PEM_B64": ""}, "MASTER_KEY_PEM_B64 must be set"},
		"a garbled master key":          {map[string]string{"MASTER_KEY_PEM_B64": base64.StdEncoding.EncodeToString([]byte("not a key"))}, "does not decode to a PEM block"},
		"a bad key id":                  {map[string]string{"MASTER_KEY_ID": "bad id:"}, "MASTER_KEY_ID must be set and match"},
		"no database to serve":          {map[string]string{"CLOUD_DATABASE_URL": ""}, "CLOUD_DATABASE_URL must be set"},
		"a broken admin document":       {map[string]string{"BOOTSTRAP_ADMIN_USER_JSON_B64": "%%%"}, "BOOTSTRAP_ADMIN_USER_JSON_B64 is not base64"},
		"a previous key without its id": {map[string]string{"MASTER_KEY_PREVIOUS_PEM_B64": base64.StdEncoding.EncodeToString([]byte(testPEM))}, "go together"},
		"no cron secret":                {map[string]string{"CRON_SECRET": ""}, "CRON_SECRET must be set"},
	}
	for _, env := range []string{"production", "preview"} {
		for name, tc := range cases {
			t.Run(env+"/"+name, func(t *testing.T) {
				stubEnsureDatabase(t)
				setLauncherEnv(t, t.TempDir())
				t.Setenv("VERCEL_ENV", env)
				t.Setenv("VERCEL_GIT_COMMIT_REF", "main")
				t.Setenv("CLOUD_DATABASE_URL", pooledURL)
				t.Setenv("CLOUD_MIGRATOR_DATABASE_URL", migratorURL)
				for key, value := range tc.set {
					t.Setenv(key, value)
				}

				_, err := prepareMigration(nil)
				assert.ErrorContains(t, err, "the serving function would refuse to start", "the build fails, the serving deployment stays")
				assert.ErrorContains(t, err, tc.reason)
			})
		}
	}

	t.Run("a local migration needs no master key", func(t *testing.T) {
		setLauncherEnv(t, t.TempDir())
		t.Setenv("MASTER_KEY_PEM_B64", "")
		t.Setenv("NEXTGEN_DATABASE_POSTGRES", "postgres://local/db")

		_, err := prepareMigration(nil)
		require.NoError(t, err)
	})
}

func TestPrepareMigrationMigratesProductionOnlyFromItsBranch(t *testing.T) {
	setLauncherEnv(t, t.TempDir())
	t.Setenv("VERCEL_ENV", "production")
	t.Setenv("CLOUD_DATABASE_URL", pooledURL)
	t.Setenv("CLOUD_MIGRATOR_DATABASE_URL", migratorURL)

	t.Setenv("VERCEL_GIT_COMMIT_REF", "feature")
	_, err := prepareMigration(nil)
	assert.ErrorContains(t, err, `refusing to migrate production from "feature": production deploys from "main"`)

	t.Setenv("VERCEL_GIT_COMMIT_REF", "")
	_, err = prepareMigration(nil)
	assert.ErrorContains(t, err, "refusing to migrate production", "a CLI deploy carries no branch")

	t.Setenv("VERCEL_GIT_COMMIT_REF", "main")
	_, err = prepareMigration(nil)
	assert.NoError(t, err)
}

func TestPrepareMigrationFollowsATestedProductionBranch(t *testing.T) {
	setLauncherEnv(t, t.TempDir())
	t.Setenv("VERCEL_ENV", "production")
	t.Setenv("CLOUD_DATABASE_URL", pooledURL)
	t.Setenv("CLOUD_MIGRATOR_DATABASE_URL", migratorURL)
	t.Setenv("CLOUD_PRODUCTION_BRANCH", "feature")

	t.Setenv("VERCEL_GIT_COMMIT_REF", "feature")
	_, err := prepareMigration(nil)
	assert.NoError(t, err, "the pull request under test deploys production")

	t.Setenv("VERCEL_GIT_COMMIT_REF", "main")
	_, err = prepareMigration(nil)
	assert.ErrorContains(t, err, `production deploys from "feature"`, "only one branch migrates production at a time")
}

func TestPrepareMigrationNeedsTheDirectURLWhenDeployed(t *testing.T) {
	stubEnsureDatabase(t)
	setLauncherEnv(t, t.TempDir())
	t.Setenv("VERCEL_ENV", "preview")
	t.Setenv("VERCEL_GIT_COMMIT_REF", branch)
	t.Setenv("CLOUD_DATABASE_URL", pooledURL)

	_, err := prepareMigration(nil)
	assert.ErrorContains(t, err, "CLOUD_MIGRATOR_DATABASE_URL must be set for a preview deployment")

	t.Setenv("VERCEL_ENV", "")
	t.Setenv("NEXTGEN_DATABASE_POSTGRES", "postgres://local/db")
	_, err = prepareMigration(nil)
	require.NoError(t, err, "a local run migrates whatever it is configured with")
	assert.Equal(t, "postgres://local/db", os.Getenv("NEXTGEN_DATABASE_POSTGRES"))
}

func TestDescribeDatabaseNamesTheHostAndDatabaseOnly(t *testing.T) {
	assert.Equal(t, " at eu-central.pg.psdb.cloud:5432/postgres", describeDatabase(migratorURL))
	assert.NotContains(t, describeDatabase(migratorURL), "secret", "credentials stay out of the logs")
	assert.Empty(t, describeDatabase(""))
	assert.Empty(t, describeDatabase("host=db user=u"))
}

func TestQuoteLiteral(t *testing.T) {
	assert.Equal(t, `'{"branch":"it''s"}'`, quoteLiteral(`{"branch":"it's"}`))
}

func TestPrepareMigrationRefusesToServeThroughTheDirectPort(t *testing.T) {
	stubEnsureDatabase(t)
	for _, env := range []string{"production", "preview"} {
		t.Run(env, func(t *testing.T) {
			setLauncherEnv(t, t.TempDir())
			t.Setenv("VERCEL_ENV", env)
			t.Setenv("VERCEL_GIT_COMMIT_REF", "main")
			t.Setenv("CLOUD_MIGRATOR_DATABASE_URL", migratorURL)
			t.Setenv("CLOUD_DATABASE_URL", strings.Replace(pooledURL, ":6432", ":5432", 1))

			_, err := prepareMigration(nil)
			assert.ErrorContains(t, err, "serve through PgBouncer", "the build fails before a deployment that cannot hold a burst goes live")

			t.Setenv("CLOUD_DATABASE_URL", pooledURL)
			_, err = prepareMigration(nil)
			assert.NoError(t, err)
		})
	}
}
