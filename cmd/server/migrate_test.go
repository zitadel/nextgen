package server

import (
	"bytes"
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	_ "modernc.org/sqlite"
)

func TestCommandHelpListsMigrate(t *testing.T) {
	cmd := NewCommand()
	var out bytes.Buffer
	cmd.SetOut(&out)
	cmd.SetErr(&out)
	cmd.SetArgs([]string{"--help"})
	require.NoError(t, cmd.Execute())

	var migrateCmd, serverCmd bool
	for _, c := range cmd.Commands() {
		switch c.Name() {
		case "migrate":
			migrateCmd = true
			assert.Equal(t, "Apply database migrations and exit", c.Short)
		case "server":
			serverCmd = true
			require.NotNil(t, c.Flags().Lookup("migrate"), "expected --migrate on server")
		}
	}
	assert.True(t, migrateCmd, "expected a command named migrate")
	assert.True(t, serverCmd, "expected a command named server")
	require.NotNil(t, cmd.Flags().Lookup("migrate"), "expected --migrate on root")
}

func TestMigrateCommandAppliesSchemaIdempotently(t *testing.T) {
	dataDir, configPath := tempServerConfig(t)

	for range 2 {
		cmd := NewCommand()
		cmd.SetArgs([]string{"migrate", "--config", configPath})
		executed, err := cmd.ExecuteC()
		require.NoError(t, err)
		assert.Equal(t, "migrate", executed.Name())
	}

	assert.True(t, sqliteHasGooseTable(t, defaultSQLitePath(dataDir)))
}

func TestStartDatabaseSkipsMigrationsUnlessRequested(t *testing.T) {
	dataDir, configPath := tempServerConfig(t)
	cfg, err := loadConfig(configPath)
	require.NoError(t, err)

	ctx := t.Context()
	skipped, err := startDatabase(ctx, cfg, false)
	require.NoError(t, err)
	require.NoError(t, skipped.Close(ctx))

	dbPath := defaultSQLitePath(dataDir)
	assert.False(t, sqliteHasGooseTable(t, dbPath), "goose table should be absent without --migrate")

	applied, err := startDatabase(ctx, cfg, true)
	require.NoError(t, err)
	require.NoError(t, applied.Close(ctx))
	assert.True(t, sqliteHasGooseTable(t, dbPath))
}

func tempServerConfig(t *testing.T) (dataDir, configPath string) {
	t.Helper()
	dataDir = t.TempDir()
	t.Setenv("NEXTGEN_SERVER_DATA_DIR", dataDir)
	configPath = filepath.Join(t.TempDir(), "nextgen.yaml")
	require.NoError(t, os.WriteFile(configPath, nil, 0o600))
	return dataDir, configPath
}

func sqliteHasGooseTable(t *testing.T, dbPath string) bool {
	t.Helper()
	db, err := sql.Open("sqlite", dbPath)
	require.NoError(t, err)
	defer db.Close()

	var name string
	err = db.QueryRow(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'goose_db_version'`).Scan(&name)
	if err == sql.ErrNoRows {
		return false
	}
	require.NoError(t, err)
	return name == "goose_db_version"
}
