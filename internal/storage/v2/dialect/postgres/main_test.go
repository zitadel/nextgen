//go:build postgres_integration

package postgres

import (
	"context"
	"crypto/rand"
	"database/sql"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib" // registers the "pgx" database/sql driver used for migrations
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database/dbtest"
	pgold "github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres/migration"
)

// The v2 postgres tests drive a real database exclusively through the v2 pool.
// The only legacy dependencies are container bring-up (dbtest), DSN recovery
// (pgold.Config), and the schema migration (migration.Migrate) — the v2 layer
// has no migrations of its own yet.

// testPool is a v2 postgres pool connected to the migrated test database,
// shared across the tests in this package.
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
	return &domain.Project{ID: id, Name: "project-" + rand.Text(), PreviewOrigins: []string{}}
}

func projectIDs(projects []*domain.Project) []string {
	ids := make([]string, len(projects))
	for i, p := range projects {
		ids[i] = p.ID
	}
	return ids
}