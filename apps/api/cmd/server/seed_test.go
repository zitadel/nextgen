package server

import (
	"context"
	"database/sql"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"

	_ "modernc.org/sqlite"
)

// What a deployment runs as it deploys: migrate, then seed. The second
// seeding finds everything in place and deploys nothing new.
func TestSeedCommandSeedsThePlatformProjectAndExits(t *testing.T) {
	dataDir, configPath := tempServerConfig(t)
	t.Setenv("NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT", "true")
	serversMasterKey(t, configPath)

	migrate := NewCommand()
	migrate.SetArgs([]string{"migrate", "--config", configPath})
	require.NoError(t, migrate.Execute())

	for range 2 {
		cmd := NewCommand()
		cmd.SetArgs([]string{"seed", "--config", configPath})
		executed, err := cmd.ExecuteC()
		require.NoError(t, err)
		assert.Equal(t, "seed", executed.Name())
	}

	dbPath := defaultSQLitePath(dataDir)
	assert.Equal(t, 1, sqliteCount(t, dbPath, `SELECT count(*) FROM projects WHERE id = ?`, domain.PlatformProjectID))
	assert.Equal(t, 1, sqliteCount(t, dbPath, `SELECT count(*) FROM deployments WHERE project_id = ?`, domain.PlatformProjectID),
		"the platform project serves the release the server ships, deployed once")
}

// Seeding never migrates: a deployment's migrate step owns the schema.
func TestSeedCommandNeedsAMigratedDatabase(t *testing.T) {
	_, configPath := tempServerConfig(t)
	t.Setenv("NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT", "true")
	serversMasterKey(t, configPath)

	cmd := NewCommand()
	cmd.SetArgs([]string{"seed", "--config", configPath})
	require.ErrorContains(t, cmd.Execute(), "failed to bootstrap platform project")
}

// The seeding wraps the platform project's keys with the master key and
// exits. A key it generated in its own data dir would be one the servers that
// start afterwards never see, so it refuses to start without theirs.
func TestSeedCommandGeneratesNoMasterKey(t *testing.T) {
	dataDir, configPath := tempServerConfig(t)
	t.Setenv("NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT", "true")

	migrate := NewCommand()
	migrate.SetArgs([]string{"migrate", "--config", configPath})
	require.NoError(t, migrate.Execute())

	cmd := NewCommand()
	cmd.SetArgs([]string{"seed", "--config", configPath})
	require.ErrorContains(t, cmd.Execute(), "seed never generates a master key")

	keys, err := os.ReadDir(filepath.Join(dataDir, defaultMasterKeyDirName))
	require.NoError(t, err)
	assert.Empty(t, keys)
	assert.Zero(t, sqliteCount(t, defaultSQLitePath(dataDir), `SELECT count(*) FROM projects`), "nothing was seeded")
}

// What a seeding wrote is committed by the time it shuts down, so a telemetry
// backend that does not answer the last export does not fail it: a deployment
// would fail its build over a database it had seeded.
func TestSeedCommandSucceedsWhenItsTelemetryCannotBeFlushed(t *testing.T) {
	dataDir, configPath := tempServerConfig(t)
	t.Setenv("NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT", "true")
	serversMasterKey(t, configPath)

	// A port nothing listens on any more.
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	closed := listener.Addr().String()
	require.NoError(t, listener.Close())
	t.Setenv("NEXTGEN_INSTRUMENTATION_METRIC_EXPORTER_TYPE", "http")
	t.Setenv("NEXTGEN_INSTRUMENTATION_METRIC_EXPORTER_ENDPOINT", closed)
	t.Setenv("NEXTGEN_INSTRUMENTATION_METRIC_EXPORTER_INSECURE", "true")

	migrate := NewCommand()
	migrate.SetArgs([]string{"migrate", "--config", configPath})
	require.NoError(t, migrate.Execute())

	cmd := NewCommand()
	cmd.SetArgs([]string{"seed", "--config", configPath})
	require.NoError(t, cmd.Execute())
	assert.Equal(t, 1, sqliteCount(t, defaultSQLitePath(dataDir), `SELECT count(*) FROM projects WHERE id = ?`, domain.PlatformProjectID))
}

// A server started with --seed=false creates nothing. On a database nothing
// seeded it refuses to start and names the command that seeds, instead of
// serving without its platform project.
func TestRunWithoutSeedingRefusesAnUnseededDatabase(t *testing.T) {
	_, configPath := tempServerConfig(t)
	cfg, err := loadConfig(configPath)
	require.NoError(t, err)
	cfg.Platform.BootstrapProject = true

	// Bounded so that a start which no longer fails is reported instead of
	// waited on until go test's own timeout.
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	err = run(ctx, cfg, nil, phases{migrate: true, serve: true})
	require.ErrorContains(t, err, "the seed command creates the platform project")
}

// The import of a --user-file is part of seeding, so a server that does not
// seed refuses one rather than start without the user it was given.
func TestServerRefusesAUserFileWithoutSeeding(t *testing.T) {
	_, configPath := tempServerConfig(t)

	cmd := NewCommand()
	cmd.SetArgs([]string{"server", "--config", configPath, "--seed=false", "--user-file", "admin.json"})
	require.ErrorContains(t, cmd.Execute(), "--user-file is imported by seeding")
}

// A boolean flag reads no value from the next argument, and a subcommand that
// took arguments would drop it: `--seed false` would seed all the same.
func TestServerAndSeedRefuseArguments(t *testing.T) {
	_, configPath := tempServerConfig(t)

	for _, args := range [][]string{
		{"server", "--config", configPath, "--seed", "false"},
		{"seed", "--config", configPath, "false"},
	} {
		cmd := NewCommand()
		cmd.SetArgs(args)
		require.ErrorContains(t, cmd.Execute(), `unexpected argument "false"`, "args: %q", args)
	}
}

// serversMasterKey leaves the master key in the data dir that a server
// started there generates, which the seeding then reads.
func serversMasterKey(t *testing.T, configPath string) {
	t.Helper()
	_, err := loadConfig(configPath)
	require.NoError(t, err)
}

func sqliteCount(t *testing.T, dbPath, query string, args ...any) int {
	t.Helper()
	db, err := sql.Open("sqlite", dbPath)
	require.NoError(t, err)
	defer db.Close()

	var count int
	require.NoError(t, db.QueryRow(query, args...).Scan(&count))
	return count
}
