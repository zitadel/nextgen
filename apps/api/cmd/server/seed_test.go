package server

import (
	"context"
	"database/sql"
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

	cmd := NewCommand()
	cmd.SetArgs([]string{"seed", "--config", configPath})
	require.ErrorContains(t, cmd.Execute(), "failed to bootstrap platform project")
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

func sqliteCount(t *testing.T, dbPath, query string, args ...any) int {
	t.Helper()
	db, err := sql.Open("sqlite", dbPath)
	require.NoError(t, err)
	defer db.Close()

	var count int
	require.NoError(t, db.QueryRow(query, args...).Scan(&count))
	return count
}
