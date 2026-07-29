//go:build postgres_integration

package postgres

import (
	"context"
	"crypto/rand"
	"fmt"
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
)

// The v2 postgres tests drive a real database exclusively through the v2 pool.
// Container/DSN bring-up still uses v1 dbtest (importing v2/dbtest from this
// package would cycle: postgres → v2/dbtest → postgres). Schema migration runs
// via the v2 pool's Migrate method.

// testPool is a v2 postgres pool connected to the migrated test database,
// shared across the tests in this package.
var testPool *Pool

func TestMain(m *testing.M) {
	os.Exit(runTests(m))
}

func runTests(m *testing.M) int {
	ctx := context.Background()

	dsn, stop, err := postgresTestDSN(ctx)
	if err != nil {
		slog.Error("failed to start postgres test database", "error", err)
		if stop != nil {
			stop()
		}
		return 1
	}
	defer stop()

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

	if err := pool.Migrate(ctx); err != nil {
		slog.Error("failed to migrate test database", "error", err)
		return 1
	}

	var ok bool
	testPool, ok = pool.(*Pool)
	if !ok {
		slog.Error("expected *Pool from the v2 postgres dialect", "type", pool)
		return 1
	}

	return m.Run()
}

// postgresTestDSN returns a Postgres DSN and stop func. Prefer
// ZITADEL_TEST_POSTGRES_URL; otherwise start a container via v1 dbtest.
func postgresTestDSN(ctx context.Context) (string, func(), error) {
	if url := os.Getenv("ZITADEL_TEST_POSTGRES_URL"); url != "" {
		return url, func() {}, nil
	}
	connector, stop, err := dbtest.Postgres(ctx)
	if err != nil {
		return "", stop, err
	}
	if stop == nil {
		stop = func() {}
	}
	cfg, ok := connector.(*pgold.Config)
	if !ok {
		stop()
		return "", nil, fmt.Errorf("expected *postgres.Config connector, got %T", connector)
	}
	return cfg.ConnString(), stop, nil
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
