package server

import (
	"bytes"
	"context"
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

	got := out.String()
	assert.Contains(t, got, "migrate")
	assert.Contains(t, got, "Apply database migrations and exit")
}

func TestMigrateCommandAppliesSchemaIdempotently(t *testing.T) {
	dataDir, configPath := tempServerConfig(t)

	for range 2 {
		cmd := NewCommand()
		cmd.SetArgs([]string{"migrate", "--config", configPath})
		require.NoError(t, cmd.Execute())
	}

	assert.True(t, sqliteHasGooseTable(t, defaultSQLitePath(dataDir)))
}

func TestStartDatabaseSkipsMigrationsUnlessRequested(t *testing.T) {
	dataDir, configPath := tempServerConfig(t)
	cfg, err := loadConfig(configPath)
	require.NoError(t, err)

	ctx := context.Background()
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
