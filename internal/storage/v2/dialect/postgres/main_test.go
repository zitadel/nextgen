//go:build postgres_integration

package postgres

import (
	"context"
	"crypto/rand"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib" // registers the "pgx" database/sql driver used for migrations
	"github.com/zitadel/nextgen/internal/domain"
	v2dbtest "github.com/zitadel/nextgen/internal/storage/v2/dbtest"
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

	pool, stop, err := v2dbtest.Postgres(ctx)
	if err != nil {
		slog.Error("failed to start postgres test database", "error", err)
		if stop != nil {
			stop()
		}
		return 1
	}
	defer stop()

	defer pool.Close(ctx)
	testPool, ok = pool.(*Pool)
	if !ok {
		slog.Error("expected *Pool from the v2 postgres dialect", "type", pool)
		return 1
	}

	return m.Run()
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
