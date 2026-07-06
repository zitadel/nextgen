//go:build postgres_integration

package postgres

import (
	"context"
	"database/sql"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib" // registers the "pgx" database/sql driver used for migrations
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	legacydb "github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dbtest"
	pgold "github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres/migration"
)

// This is a storage-level test for the v2 postgres project statements: it drives
// a real database exclusively through the v2 pool. The only legacy dependencies
// are container bring-up (dbtest), DSN recovery (pgold.Config), and the schema
// migration (migration.Migrate) — the v2 layer has no migrations of its own yet.
// Spanner is not covered here: the v2 spanner statements are unimplemented
// (tracked in zitadel/nextgen#457).

// testPool is a v2 postgres pool connected to the migrated test database.
var testPool *Pool

func TestMain(m *testing.M) {
	os.Exit(runTests(m))
}

func runTests(m *testing.M) int {
	ctx := context.Background()

	connector, stop, err := dbtest.Postgres(ctx)
	if err != nil {
		slog.Error("failed to start postgres test database", "error", err)
		if stop != nil {
			stop()
		}
		return 1
	}
	defer stop()

	// Recover the DSN from the connector without ever connecting a legacy pool.
	cfg, ok := connector.(*pgold.Config)
	if !ok {
		slog.Error("expected *postgres.Config connector", "type", connector)
		return 1
	}
	dsn := cfg.ConnString()

	// Migrate the zitadel_nextgen schema via a throwaway *sql.DB. migration.Migrate
	// is pool-independent; borrowing it is unavoidable until v2 grows its own.
	if err := migrate(ctx, dsn); err != nil {
		slog.Error("failed to migrate test database", "error", err)
		return 1
	}

	// Connect the v2 pool from the same DSN.
	dialect, err := DecodeConfig(dsn)
	if err != nil {
		slog.Error("failed to decode v2 postgres config", "error", err)
		return 1
	}
	pool, err := dialect.Connect(ctx)
	if err != nil {
		slog.Error("failed to connect v2 postgres pool", "error", err)
		return 1
	}
	defer pool.Close(ctx)
	testPool, ok = pool.(*Pool)
	if !ok {
		slog.Error("expected *Pool from the v2 postgres dialect", "type", pool)
		return 1
	}

	return m.Run()
}

func migrate(ctx context.Context, dsn string) error {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return err
	}
	defer db.Close()
	return migration.Migrate(ctx, db)
}

// uniqueProjectID returns a collision-free project ID scoped to the running
// (sub)test. The v2 statements commit immediately (no rollback), so isolation
// relies on unique IDs plus DeleteProjectByID cleanup rather than a transaction.
func uniqueProjectID(t *testing.T) string {
	t.Helper()
	return "proj-" + strings.ReplaceAll(t.Name(), "/", "_") + "-" + strconv.FormatInt(time.Now().UnixNano(), 10)
}

// newTestProject builds a persistable project. PreviewOrigins is a non-nil empty
// slice because the projects table declares preview_origins NOT NULL.
func newTestProject(id string) *domain.Project {
	return &domain.Project{ID: id, PreviewOrigins: []string{}}
}

func TestProjectStatements_Create(t *testing.T) {
	t.Run("creates project and timestamps are set", func(t *testing.T) {
		project := newTestProject(uniqueProjectID(t))
		t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), project.ID) })

		require.NoError(t, testPool.CreateProject(t.Context(), project))
		assert.False(t, project.CreatedAt.IsZero())
		assert.False(t, project.UpdatedAt.IsZero())
		assert.WithinDuration(t, time.Now(), project.CreatedAt, 5*time.Second)
		assert.WithinDuration(t, time.Now(), project.UpdatedAt, 5*time.Second)

		stored, err := testPool.GetProjectByID(t.Context(), project.ID)
		require.NoError(t, err)
		assert.Equal(t, project.ID, stored.ID)
		assert.False(t, stored.CreatedAt.IsZero())
		assert.False(t, stored.UpdatedAt.IsZero())
	})

	t.Run("duplicate ID returns error", func(t *testing.T) {
		project := newTestProject(uniqueProjectID(t))
		t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), project.ID) })
		require.NoError(t, testPool.CreateProject(t.Context(), project))

		err := testPool.CreateProject(t.Context(), newTestProject(project.ID))
		assert.Error(t, err)
	})
}

func TestProjectStatements_Get(t *testing.T) {
	t.Run("returns project by ID", func(t *testing.T) {
		project := newTestProject(uniqueProjectID(t))
		t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), project.ID) })
		require.NoError(t, testPool.CreateProject(t.Context(), project))

		stored, err := testPool.GetProjectByID(t.Context(), project.ID)
		require.NoError(t, err)
		assert.Equal(t, project.ID, stored.ID)
		assert.False(t, stored.CreatedAt.IsZero())
		assert.False(t, stored.UpdatedAt.IsZero())
	})

	t.Run("not found returns NoRowFoundError", func(t *testing.T) {
		_, err := testPool.GetProjectByID(t.Context(), uniqueProjectID(t))
		assert.ErrorIs(t, err, new(legacydb.NoRowFoundError))
	})
}
