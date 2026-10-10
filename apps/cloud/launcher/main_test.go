package main

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/cmd/server"
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
	t.Setenv("VERCEL_REGION", "")
	t.Setenv("CLOUD_DATABASE_KEY", "")
	t.Setenv("NEXTGEN_PLATFORM_HOME_URL", "")
	t.Setenv("CLOUD_HOME_BYPASS_SECRET", "")
	t.Setenv("NEXTGEN_SERVER_PUBLIC_BASE", "")
	t.Setenv(uiModeVariable, "")
	t.Setenv(regionsVariable, "")
	for _, name := range []string{roleVariable, prefixVariable, hostVariable, "VERCEL_URL", "VERCEL_BRANCH_URL", "VERCEL_PROJECT_PRODUCTION_URL"} {
		t.Setenv(name, "")
	}
	for _, kv := range os.Environ() {
		if name, _, _ := strings.Cut(kv, "="); isDatabaseURLVariable(name, false) {
			t.Setenv(name, "")
		}
	}
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

func TestRegionalDatabases(t *testing.T) {
	const (
		fra1 = "postgresql://u:p@eu.example:6432/postgres?sslmode=verify-full"
		cle1 = "postgresql://u:p@us.example:6432/postgres?sslmode=verify-full"
	)

	t.Run("a function serves from the database of its region, schema rule applied", func(t *testing.T) {
		setLauncherEnv(t, t.TempDir())
		t.Setenv("VERCEL_ENV", "preview")
		t.Setenv("VERCEL_GIT_PULL_REQUEST_ID", "77")
		t.Setenv("VERCEL_REGION", "cle1")
		t.Setenv("NEXTGEN_DATABASE_POSTGRES", previewDSN)
		t.Setenv("CLOUD_DATABASE_URL_FRA1", fra1)
		t.Setenv("CLOUD_DATABASE_URL_CLE1", cle1)
		t.Setenv("CLOUD_MIGRATOR_DATABASE_URL_CLE1", "postgresql://migrator:p@us.example:5432/postgres")

		_, err := prepare(nil)
		require.NoError(t, err)
		assert.Equal(t, cle1+"&schema=pr_77", os.Getenv("NEXTGEN_DATABASE_POSTGRES"))
		assert.Empty(t, os.Getenv("CLOUD_DATABASE_URL_FRA1"), "another region's database leaves the environment")
		assert.Empty(t, os.Getenv("CLOUD_DATABASE_URL_CLE1"))
		assert.Empty(t, os.Getenv("CLOUD_MIGRATOR_DATABASE_URL_CLE1"), "the migrator role leaves the serving function")
	})

	t.Run("a region without a database refuses to start", func(t *testing.T) {
		setLauncherEnv(t, t.TempDir())
		t.Setenv("VERCEL_REGION", "iad1")
		t.Setenv("NEXTGEN_DATABASE_POSTGRES", previewDSN)
		t.Setenv("CLOUD_DATABASE_URL_FRA1", fra1)
		t.Setenv("CLOUD_DATABASE_URL_CLE1", cle1)

		_, err := prepare(nil)
		assert.ErrorContains(t, err, "no CLOUD_DATABASE_URL_IAD1")
		assert.ErrorContains(t, err, "CLE1, FRA1")
	})

	t.Run("without regional databases the plain pair applies", func(t *testing.T) {
		setLauncherEnv(t, t.TempDir())
		t.Setenv("VERCEL_REGION", "fra1")
		t.Setenv("NEXTGEN_DATABASE_POSTGRES", previewDSN)

		_, err := prepare(nil)
		require.NoError(t, err)
		assert.Equal(t, previewDSN, os.Getenv("NEXTGEN_DATABASE_POSTGRES"))
		assert.Empty(t, regionalMigrationTargets())
	})

	t.Run("the build migrates every regional database, migrator role first", func(t *testing.T) {
		setLauncherEnv(t, t.TempDir())
		t.Setenv("NEXTGEN_DATABASE_POSTGRES", previewDSN)
		t.Setenv("CLOUD_DATABASE_URL_FRA1", fra1)
		t.Setenv("CLOUD_DATABASE_URL_CLE1", cle1)
		t.Setenv("CLOUD_MIGRATOR_DATABASE_URL_CLE1", "postgresql://migrator:p@us.example:5432/postgres")

		assert.Equal(t, []migrationTarget{
			{region: "CLE1", url: "postgresql://migrator:p@us.example:5432/postgres"},
			{region: "FRA1", url: fra1},
		}, regionalMigrationTargets())

		env := childEnv([]string{
			"PATH=/bin",
			"NEXTGEN_DATABASE_POSTGRES=" + previewDSN,
			"CLOUD_MIGRATOR_DATABASE_URL=postgresql://m:p@db.example:5432/postgres",
			"CLOUD_DATABASE_URL_FRA1=" + fra1,
			"CLOUD_DATABASE_URL_CLE1=" + cle1,
			"CLOUD_MIGRATOR_DATABASE_URL_CLE1=postgresql://migrator:p@us.example:5432/postgres",
			"VERCEL_ENV=preview",
		}, cle1)
		assert.Equal(t, []string{"PATH=/bin", "VERCEL_ENV=preview", "NEXTGEN_DATABASE_POSTGRES=" + cle1}, env,
			"the child sees exactly one database")
	})

	t.Run("the database key is the upper-case region code unless CLOUD_DATABASE_KEY names another", func(t *testing.T) {
		t.Setenv("CLOUD_DATABASE_KEY", "")
		t.Setenv("VERCEL_REGION", "fra1")
		assert.Equal(t, "FRA1", databaseKey())
		t.Setenv("VERCEL_REGION", "dev-1")
		assert.Equal(t, "DEV_1", databaseKey())
		t.Setenv("VERCEL_REGION", "")
		assert.Empty(t, databaseKey())
		t.Setenv("CLOUD_DATABASE_KEY", "home")
		t.Setenv("VERCEL_REGION", "fra1")
		assert.Equal(t, "HOME", databaseKey())
	})

	t.Run("a service with its own database in a shared region serves from it", func(t *testing.T) {
		setLauncherEnv(t, t.TempDir())
		t.Setenv("VERCEL_REGION", "fra1")
		t.Setenv("CLOUD_DATABASE_KEY", "home")
		t.Setenv("CLOUD_DATABASE_URL_FRA1", fra1)
		t.Setenv("CLOUD_DATABASE_URL_HOME", "postgresql://u:p@eu.example:6432/postgres?schema=home")

		_, err := prepare(nil)
		require.NoError(t, err)
		assert.Equal(t, "postgresql://u:p@eu.example:6432/postgres?schema=home", os.Getenv("NEXTGEN_DATABASE_POSTGRES"))
		assert.Empty(t, os.Getenv("CLOUD_DATABASE_URL_FRA1"))
	})
}

func TestPrepareRendersTheHomeHeaders(t *testing.T) {
	dataDir := t.TempDir()
	setLauncherEnv(t, dataDir)
	t.Setenv("NEXTGEN_PLATFORM_HOME_URL", "https://home.example")
	t.Setenv("CLOUD_HOME_BYPASS_SECRET", "bypass-secret")

	_, err := prepare(nil)
	require.NoError(t, err)

	config, err := os.ReadFile(filepath.Join(dataDir, "nextgen.yaml"))
	require.NoError(t, err)
	assert.True(t, strings.HasSuffix(string(config),
		"platform:\n"+
			"  home:\n"+
			"    headers:\n"+
			"      x-vercel-protection-bypass: \"bypass-secret\"\n"), string(config))
	assert.Empty(t, os.Getenv("CLOUD_HOME_BYPASS_SECRET"), "the secret leaves the environment once it is on disk")

	t.Run("no home, no headers", func(t *testing.T) {
		setLauncherEnv(t, t.TempDir())
		t.Setenv("CLOUD_HOME_BYPASS_SECRET", "bypass-secret")
		_, err := prepare(nil)
		require.NoError(t, err)
		config, err := os.ReadFile(filepath.Join(os.Getenv("NEXTGEN_SERVER_DATA_DIR"), "nextgen.yaml"))
		require.NoError(t, err)
		assert.NotContains(t, string(config), "platform:")
	})
}

func TestPrepareDerivesTheURLsOfARole(t *testing.T) {
	t.Run("a region under a prefix", func(t *testing.T) {
		dataDir := t.TempDir()
		setLauncherEnv(t, dataDir)
		t.Setenv(roleVariable, "region")
		t.Setenv(prefixVariable, "/eu")
		t.Setenv(hostVariable, "cloud.example")
		t.Setenv("CLOUD_HOME_BYPASS_SECRET", "bypass-secret")

		_, err := prepare(nil)
		require.NoError(t, err)
		assert.Equal(t, "https://cloud.example/eu", os.Getenv("NEXTGEN_SERVER_PUBLIC_BASE"))
		assert.Equal(t, "https://cloud.example", os.Getenv("NEXTGEN_PLATFORM_HOME_URL"))
		config, err := os.ReadFile(filepath.Join(dataDir, "nextgen.yaml"))
		require.NoError(t, err)
		assert.Contains(t, string(config), "x-vercel-protection-bypass: \"bypass-secret\"", "the home URL derived from the role enables the home headers")
	})
	t.Run("the home at the root", func(t *testing.T) {
		setLauncherEnv(t, t.TempDir())
		t.Setenv(roleVariable, "home")
		t.Setenv(hostVariable, "cloud.example")
		_, err := prepare(nil)
		require.NoError(t, err)
		assert.Equal(t, "https://cloud.example", os.Getenv("NEXTGEN_SERVER_PUBLIC_BASE"))
		assert.Empty(t, os.Getenv("NEXTGEN_PLATFORM_HOME_URL"), "the home has no home")
	})
	t.Run("explicit settings win", func(t *testing.T) {
		setLauncherEnv(t, t.TempDir())
		t.Setenv(roleVariable, "region")
		t.Setenv(prefixVariable, "/eu")
		t.Setenv(hostVariable, "cloud.example")
		t.Setenv("NEXTGEN_SERVER_PUBLIC_BASE", "https://api.example/eu")
		t.Setenv("NEXTGEN_PLATFORM_HOME_URL", "https://home.example")
		_, err := prepare(nil)
		require.NoError(t, err)
		assert.Equal(t, "https://api.example/eu", os.Getenv("NEXTGEN_SERVER_PUBLIC_BASE"))
		assert.Equal(t, "https://home.example", os.Getenv("NEXTGEN_PLATFORM_HOME_URL"))
	})
	t.Run("no role, nothing derived", func(t *testing.T) {
		setLauncherEnv(t, t.TempDir())
		t.Setenv("VERCEL_URL", "x.vercel.app")
		_, err := prepare(nil)
		require.NoError(t, err)
		assert.Empty(t, os.Getenv("NEXTGEN_SERVER_PUBLIC_BASE"))
	})
	t.Run("refused", func(t *testing.T) {
		for name, env := range map[string]map[string]string{
			"unknown role":  {roleVariable: "edge", hostVariable: "cloud.example"},
			"bad prefix":    {roleVariable: "region", prefixVariable: "eu/", hostVariable: "cloud.example"},
			"no host known": {roleVariable: "region", prefixVariable: "/eu"},
		} {
			t.Run(name, func(t *testing.T) {
				setLauncherEnv(t, t.TempDir())
				for k, v := range env {
					t.Setenv(k, v)
				}
				_, err := prepare(nil)
				require.Error(t, err)
			})
		}
	})
}

func TestPrepareSetsTheUIMode(t *testing.T) {
	t.Run("external by default", func(t *testing.T) {
		setLauncherEnv(t, t.TempDir())
		_, err := prepare(nil)
		require.NoError(t, err)
		assert.Equal(t, server.UIExternal, os.Getenv(uiModeVariable))
	})
	t.Run("a region is headless", func(t *testing.T) {
		setLauncherEnv(t, t.TempDir())
		t.Setenv(roleVariable, "region")
		t.Setenv(hostVariable, "cloud.example")
		_, err := prepare(nil)
		require.NoError(t, err)
		assert.Equal(t, server.UIHeadless, os.Getenv(uiModeVariable))
	})
	t.Run("explicit wins", func(t *testing.T) {
		setLauncherEnv(t, t.TempDir())
		t.Setenv(roleVariable, "region")
		t.Setenv(hostVariable, "cloud.example")
		t.Setenv(uiModeVariable, server.UIEmbedded)
		_, err := prepare(nil)
		require.NoError(t, err)
		assert.Equal(t, server.UIEmbedded, os.Getenv(uiModeVariable))
	})
}

func TestPrepareRendersTheRegions(t *testing.T) {
	dataDir := t.TempDir()
	setLauncherEnv(t, dataDir)
	t.Setenv(regionsVariable, `[{"id":"eu","name":"EU (Frankfurt)","api_base":"/eu"},{"id":"us","name":"US (Ohio)","api_base":"/us"}]`)

	_, err := prepare(nil)
	require.NoError(t, err)
	config, err := os.ReadFile(filepath.Join(dataDir, "nextgen.yaml"))
	require.NoError(t, err)
	assert.True(t, strings.HasSuffix(string(config),
		"platform:\n"+
			"  regions:\n"+
			"    - id: \"eu\"\n"+
			"      name: \"EU (Frankfurt)\"\n"+
			"      api_base: \"/eu\"\n"+
			"    - id: \"us\"\n"+
			"      name: \"US (Ohio)\"\n"+
			"      api_base: \"/us\"\n"), string(config))

	t.Run("with the home headers, one platform block", func(t *testing.T) {
		dataDir := t.TempDir()
		setLauncherEnv(t, dataDir)
		t.Setenv(regionsVariable, `[{"id":"eu","name":"EU","api_base":"/eu"}]`)
		t.Setenv("NEXTGEN_PLATFORM_HOME_URL", "https://home.example")
		t.Setenv("CLOUD_HOME_BYPASS_SECRET", "bypass-secret")
		_, err := prepare(nil)
		require.NoError(t, err)
		config, err := os.ReadFile(filepath.Join(dataDir, "nextgen.yaml"))
		require.NoError(t, err)
		assert.Equal(t, 1, strings.Count(string(config), "platform:\n"))
		assert.Contains(t, string(config), "  home:\n    headers:\n")
		assert.Contains(t, string(config), "  regions:\n    - id: \"eu\"\n")
	})
	t.Run("refused", func(t *testing.T) {
		for name, value := range map[string]string{"not json": "eu,us", "missing field": `[{"id":"eu","name":"EU"}]`} {
			t.Run(name, func(t *testing.T) {
				setLauncherEnv(t, t.TempDir())
				t.Setenv(regionsVariable, value)
				_, err := prepare(nil)
				require.Error(t, err)
			})
		}
	})
}
