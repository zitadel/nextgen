package main

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const testPEM = "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu\n-----END RSA PRIVATE KEY-----\n"

func setLauncherEnv(t *testing.T, dataDir string) {
	t.Helper()
	t.Setenv("NEXTGEN_SERVER_DATA_DIR", dataDir)
	t.Setenv("MASTER_KEY_PEM_B64", base64.StdEncoding.EncodeToString([]byte(testPEM)))
	t.Setenv("MASTER_KEY_ID", "")
	t.Setenv("BOOTSTRAP_ADMIN_USER_JSON_B64", "")
	t.Setenv("PORT", "")
	t.Setenv("NEXTGEN_SERVER_ADDRESS", "")
	t.Setenv("NEXTGEN_DATABASE_POSTGRES", "")
	t.Setenv("CLOUD_MIGRATOR_DATABASE_URL", "")
	t.Setenv("VERCEL_ENV", "")
	t.Setenv("VERCEL_GIT_PULL_REQUEST_ID", "")
	t.Setenv("VERCEL_GIT_COMMIT_REF", "")
}

func TestPrepareRendersTheMasterKeyIntoTheConfig(t *testing.T) {
	dataDir := t.TempDir()
	setLauncherEnv(t, dataDir)
	t.Setenv("MASTER_KEY_ID", "preview-2026-10")
	t.Setenv("PORT", "9090")

	args, err := prepare(nil)
	require.NoError(t, err)

	configPath := filepath.Join(dataDir, "nextgen.yaml")
	assert.Equal(t, []string{"server", "--config", configPath}, args)

	config, err := os.ReadFile(configPath)
	require.NoError(t, err)
	assert.Equal(t, "server:\n"+
		"  generate_master_key: false\n"+
		"  master_keys:\n"+
		"    preview-2026-10:\n"+
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

func TestPrepareDefaultsAndNormalizesThePEM(t *testing.T) {
	dataDir := t.TempDir()
	setLauncherEnv(t, dataDir)
	// Pasted keys arrive with carriage returns, blank lines and indentation.
	t.Setenv("MASTER_KEY_PEM_B64", base64.StdEncoding.EncodeToString([]byte(
		"  -----BEGIN RSA PRIVATE KEY-----\r\n\r\n   MIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu\r\n-----END RSA PRIVATE KEY-----\r\n")))

	_, err := prepare(nil)
	require.NoError(t, err)

	config, err := os.ReadFile(filepath.Join(dataDir, "nextgen.yaml"))
	require.NoError(t, err)
	assert.Contains(t, string(config), "    preview:\n", "the key id defaults to preview")
	assert.Contains(t, string(config), "        -----BEGIN RSA PRIVATE KEY-----\n        MIIBOg")
	assert.NotContains(t, string(config), "\r")
	assert.Equal(t, ":8080", os.Getenv("NEXTGEN_SERVER_ADDRESS"), "PORT defaults to 8080")
}

func TestPrepareRendersTheBootstrapAdminDocument(t *testing.T) {
	dataDir := t.TempDir()
	setLauncherEnv(t, dataDir)
	doc := `{"header":{"version":1},"authenticators":[]}`
	t.Setenv("BOOTSTRAP_ADMIN_USER_JSON_B64", base64.StdEncoding.EncodeToString([]byte(doc)))

	args, err := prepare([]string{"--log-level", "debug"})
	require.NoError(t, err)

	adminPath := filepath.Join(dataDir, "admin-user.json")
	assert.Equal(t, []string{"server", "--config", filepath.Join(dataDir, "nextgen.yaml"), "--user-file", adminPath, "--log-level", "debug"}, args)
	written, err := os.ReadFile(adminPath)
	require.NoError(t, err)
	assert.Equal(t, doc, string(written))
	assert.Empty(t, os.Getenv("BOOTSTRAP_ADMIN_USER_JSON_B64"))
}

func TestPrepareRefusesBadInput(t *testing.T) {
	cases := map[string]func(t *testing.T){
		"--migrate so a serving function can never change the schema": func(t *testing.T) {
			_, err := prepare([]string{"--migrate"})
			assert.ErrorContains(t, err, "refusing --migrate")
			_, err = prepare([]string{"--migrate=true"})
			assert.ErrorContains(t, err, "refusing --migrate")
		},
		"a missing master key": func(t *testing.T) {
			t.Setenv("MASTER_KEY_PEM_B64", "")
			_, err := prepare(nil)
			assert.ErrorContains(t, err, "MASTER_KEY_PEM_B64 must be set")
		},
		"a key that is not a PEM block": func(t *testing.T) {
			t.Setenv("MASTER_KEY_PEM_B64", base64.StdEncoding.EncodeToString([]byte("not a key")))
			_, err := prepare(nil)
			assert.ErrorContains(t, err, "does not decode to a PEM block")
		},
		"a key id that cannot be written into YAML unquoted": func(t *testing.T) {
			t.Setenv("MASTER_KEY_ID", "bad id:")
			_, err := prepare(nil)
			assert.ErrorContains(t, err, "MASTER_KEY_ID must match")
		},
		"an admin document that is not a bootstrap user": func(t *testing.T) {
			t.Setenv("BOOTSTRAP_ADMIN_USER_JSON_B64", base64.StdEncoding.EncodeToString([]byte(`{"email":"x"}`)))
			_, err := prepare(nil)
			assert.ErrorContains(t, err, "bootstrap user document")
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			setLauncherEnv(t, t.TempDir())
			tc(t)
			assert.False(t, strings.HasPrefix(os.Getenv("NEXTGEN_SERVER_ADDRESS"), ":"), "nothing is configured when input is refused")
		})
	}
}

const previewDSN = "postgresql://u:p@db.example:5432/postgres?sslmode=verify-full"

func TestResolveDatabaseURLPicksTheSchemaOfTheDeployment(t *testing.T) {
	setLauncherEnv(t, t.TempDir())

	t.Run("production and local runs use the URL as configured", func(t *testing.T) {
		for _, env := range []string{"production", "development", ""} {
			dsn, schema, err := resolveDatabaseURL(previewDSN, env)
			require.NoError(t, err)
			assert.Equal(t, previewDSN, dsn, env)
			assert.Equal(t, "zitadel_nextgen", schema, env)
		}
	})

	t.Run("a preview of a pull request gets pr_<id>", func(t *testing.T) {
		t.Setenv("VERCEL_GIT_PULL_REQUEST_ID", "1518")
		t.Setenv("VERCEL_GIT_COMMIT_REF", "feature/x")
		dsn, schema, err := resolveDatabaseURL(previewDSN, "preview")
		require.NoError(t, err)
		assert.Equal(t, previewDSN+"&schema=pr_1518", dsn)
		assert.Equal(t, "pr_1518", schema)
	})

	t.Run("a preview of a branch without a pull request gets br_<name>", func(t *testing.T) {
		t.Setenv("VERCEL_GIT_COMMIT_REF", "claude/Nextgen-Deployment research--3b5ebe")
		dsn, schema, err := resolveDatabaseURL("postgresql://u:p@db.example:5432/postgres", "preview")
		require.NoError(t, err)
		assert.Equal(t, "postgresql://u:p@db.example:5432/postgres?schema=br_claude_nextgen_deployment_research_3b5ebe", dsn)
		assert.Equal(t, "br_claude_nextgen_deployment_research_3b5ebe", schema)
	})

	t.Run("an explicit schema or search_path wins", func(t *testing.T) {
		t.Setenv("VERCEL_GIT_PULL_REQUEST_ID", "1518")
		for _, explicit := range []string{"&schema=pr_demo2", "&search_path=pr_demo2"} {
			dsn, _, err := resolveDatabaseURL(previewDSN+explicit, "preview")
			require.NoError(t, err)
			assert.Equal(t, previewDSN+explicit, dsn)
		}
	})

	t.Run("a parameter that merely contains the word schema does not count", func(t *testing.T) {
		t.Setenv("VERCEL_GIT_PULL_REQUEST_ID", "1518")
		dsn, schema, err := resolveDatabaseURL(previewDSN+"&default_query_exec_mode=cache_describe", "preview")
		require.NoError(t, err)
		assert.Equal(t, previewDSN+"&default_query_exec_mode=cache_describe&schema=pr_1518", dsn)
		assert.Equal(t, "pr_1518", schema)
	})

	t.Run("a preview needs a pull request or a branch", func(t *testing.T) {
		_, _, err := resolveDatabaseURL(previewDSN, "preview")
		assert.ErrorContains(t, err, "cannot pick a schema")
	})

	t.Run("deployments need a database", func(t *testing.T) {
		_, _, err := resolveDatabaseURL("", "production")
		assert.ErrorContains(t, err, "must be set")
		dsn, _, err := resolveDatabaseURL("", "")
		require.NoError(t, err)
		assert.Empty(t, dsn, "a local run may fall through to the server defaults")
	})
}

func TestSanitizeSchemaPart(t *testing.T) {
	t.Parallel()
	assert.Equal(t, "fix_login_v2", sanitizeSchemaPart("Fix/Login--v2"))
	assert.Equal(t, "x", sanitizeSchemaPart("///"))
	assert.LessOrEqual(t, len("br_"+sanitizeSchemaPart(strings.Repeat("a-", 80))), 63)
}

func TestPrepareMigrationGuardsProductionAndResolvesTheSchema(t *testing.T) {
	t.Run("production migrates only from main", func(t *testing.T) {
		setLauncherEnv(t, t.TempDir())
		t.Setenv("VERCEL_ENV", "production")
		t.Setenv("VERCEL_GIT_COMMIT_REF", "feature/x")
		t.Setenv("NEXTGEN_DATABASE_POSTGRES", previewDSN)
		_, err := prepareMigration(nil)
		assert.ErrorContains(t, err, "refusing to migrate production")
	})

	t.Run("production from main uses the migrator role as configured", func(t *testing.T) {
		setLauncherEnv(t, t.TempDir())
		t.Setenv("VERCEL_ENV", "production")
		t.Setenv("VERCEL_GIT_COMMIT_REF", "main")
		t.Setenv("NEXTGEN_DATABASE_POSTGRES", previewDSN)
		t.Setenv("CLOUD_MIGRATOR_DATABASE_URL", "postgresql://migrator:p@db.example:5432/postgres")
		args, err := prepareMigration([]string{"--log-level", "debug"})
		require.NoError(t, err)
		assert.Equal(t, []string{"migrate", "--log-level", "debug"}, args)
		assert.Equal(t, "postgresql://migrator:p@db.example:5432/postgres", os.Getenv("NEXTGEN_DATABASE_POSTGRES"))
		assert.Empty(t, os.Getenv("CLOUD_MIGRATOR_DATABASE_URL"))
	})

	t.Run("a preview migrates its own schema", func(t *testing.T) {
		setLauncherEnv(t, t.TempDir())
		t.Setenv("VERCEL_ENV", "preview")
		t.Setenv("VERCEL_GIT_PULL_REQUEST_ID", "77")
		t.Setenv("NEXTGEN_DATABASE_POSTGRES", previewDSN)
		args, err := prepareMigration(nil)
		require.NoError(t, err)
		assert.Equal(t, []string{"migrate"}, args)
		assert.Equal(t, previewDSN+"&schema=pr_77", os.Getenv("NEXTGEN_DATABASE_POSTGRES"))
	})
}

func TestPrepareServesTheSameSchemaTheBuildMigrated(t *testing.T) {
	setLauncherEnv(t, t.TempDir())
	t.Setenv("VERCEL_ENV", "preview")
	t.Setenv("VERCEL_GIT_PULL_REQUEST_ID", "77")
	t.Setenv("NEXTGEN_DATABASE_POSTGRES", previewDSN)

	_, err := prepare(nil)
	require.NoError(t, err)
	assert.Equal(t, previewDSN+"&schema=pr_77", os.Getenv("NEXTGEN_DATABASE_POSTGRES"))
}
