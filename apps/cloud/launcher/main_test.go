package main

import (
	"context"
	"encoding/base64"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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
		"NEXTGEN_DATABASE_POSTGRES",
		"NEXTGEN_INSTRUMENTATION_LOG_FORMAT",
		"NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT",
		"NEXTGEN_SERVER_ADDRESS",
		"NEXTGEN_SERVER_CONSOLE_ENABLED",
		"NEXTGEN_SERVER_CONSOLE_PATH",
		"NEXTGEN_SERVER_LOGIN_ENABLED",
		"NEXTGEN_SERVER_PUBLIC_BASE",
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
}

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

	args, err := prepareServer(nil)
	require.NoError(t, err)

	configPath := filepath.Join(dataDir, "nextgen.yaml")
	assert.Equal(t, []string{"server", "--config", configPath}, args)

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
	// Leftovers from an earlier layout must not move the console or the login.
	t.Setenv("NEXTGEN_SERVER_CONSOLE_ENABLED", "true")
	t.Setenv("NEXTGEN_SERVER_CONSOLE_PATH", "/console")
	t.Setenv("NEXTGEN_SERVER_LOGIN_ENABLED", "false")

	_, err := prepareServer(nil)
	require.NoError(t, err)

	assert.Equal(t, "false", os.Getenv("NEXTGEN_SERVER_CONSOLE_ENABLED"), "the console is a service of its own")
	assert.Equal(t, "/ui/console", os.Getenv("NEXTGEN_SERVER_CONSOLE_PATH"), "where vercel.json mounts the console")
	assert.Equal(t, "true", os.Getenv("NEXTGEN_SERVER_LOGIN_ENABLED"), "keeps /console/runtime.json mounted")
	assert.Equal(t, "true", os.Getenv("NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT"))
	assert.Equal(t, "json", os.Getenv("NEXTGEN_INSTRUMENTATION_LOG_FORMAT"))
	assert.Equal(t, "https://nextgen-preview-cloud.vercel.app", os.Getenv("NEXTGEN_SERVER_PUBLIC_BASE"))
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
	doc := `{"header":{"version":1},"authenticators":[]}`
	t.Setenv("BOOTSTRAP_ADMIN_USER_JSON_B64", base64.StdEncoding.EncodeToString([]byte(doc)))

	args, err := prepareServer([]string{"--disable-master-key-generation"})
	require.NoError(t, err)

	adminPath := filepath.Join(dataDir, "admin-user.json")
	assert.Equal(t, []string{"server", "--config", filepath.Join(dataDir, "nextgen.yaml"), "--user-file", adminPath, "--disable-master-key-generation"}, args)
	written, err := os.ReadFile(adminPath)
	require.NoError(t, err)
	assert.Equal(t, doc, string(written))
	assert.Empty(t, os.Getenv("BOOTSTRAP_ADMIN_USER_JSON_B64"))
}

func TestPrepareServerLocallyKeepsTheConfiguredDatabase(t *testing.T) {
	setLauncherEnv(t, t.TempDir())
	t.Setenv("NEXTGEN_DATABASE_POSTGRES", "postgres://local/db")

	_, err := prepareServer(nil)
	require.NoError(t, err)

	assert.Equal(t, "postgres://local/db", os.Getenv("NEXTGEN_DATABASE_POSTGRES"), "without CLOUD_DATABASE_URL a local run keeps its own database")
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
		"a database URL that is not a postgres URL": func(t *testing.T) {
			t.Setenv("CLOUD_DATABASE_URL", "host=db user=u")
			_, err := prepareServer(nil)
			assert.ErrorContains(t, err, "must be postgres:// or postgresql:// URLs")
		},
		"a bootstrap document that is not one": func(t *testing.T) {
			t.Setenv("BOOTSTRAP_ADMIN_USER_JSON_B64", base64.StdEncoding.EncodeToString([]byte(`{"user":"x"}`)))
			_, err := prepareServer(nil)
			assert.ErrorContains(t, err, "does not decode to a bootstrap user document")
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

func TestPrepareMigrationMigratesProductionInPlace(t *testing.T) {
	calls := stubEnsureDatabase(t)
	setLauncherEnv(t, t.TempDir())
	t.Setenv("VERCEL_ENV", "production")
	t.Setenv("VERCEL_GIT_COMMIT_REF", "main")
	t.Setenv("CLOUD_MIGRATOR_DATABASE_URL", migratorURL)

	_, err := prepareMigration(nil)
	require.NoError(t, err)

	assert.Empty(t, *calls, "production creates no database")
	assert.Equal(t, migratorURL, os.Getenv("NEXTGEN_DATABASE_POSTGRES"))
}

func TestPrepareMigrationMigratesProductionOnlyFromItsBranch(t *testing.T) {
	setLauncherEnv(t, t.TempDir())
	t.Setenv("VERCEL_ENV", "production")
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
