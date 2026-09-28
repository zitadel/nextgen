//go:build postgres_integration

package postgres

import (
	"context"
	"crypto/rand"
	"log/slog"
	"os"
	"strings"
	"testing"

	_ "github.com/jackc/pgx/v5/stdlib" // registers the "pgx" database/sql driver used for migrations
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/testdb"
)

// testPool is a v2 postgres pool connected to the migrated test database,
// shared across the tests in this package.
var testPool *Pool

func TestMain(m *testing.M) {
	os.Exit(runTests(m))
}

func runTests(m *testing.M) int {
	ctx := context.Background()

	dsn, stop, err := testdb.PostgresDSN(ctx)
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

// uniqueSuffix builds a fixture suffix that is unique across calls.
// In the case of a time-based randomness, two calls within one test can read the same clock value and lead to flakiness.
func uniqueSuffix(t *testing.T) string {
	t.Helper()
	return strings.ReplaceAll(t.Name(), "/", "_") + "-" + rand.Text()
}

// uniqueProjectID returns a collision-free project ID scoped to the running
// (sub)test. The v2 statements commit immediately (no rollback), so isolation
// relies on unique IDs plus DeleteProjectByID cleanup rather than a transaction.
func uniqueProjectID(t *testing.T) string {
	t.Helper()
	return "proj-" + uniqueSuffix(t)
}

// newTestProject builds a persistable project. PreviewOrigins is a non-nil empty
// slice because the projects table declares preview_origins NOT NULL.
func newTestProject(id string) *domain.Project {
	return &domain.Project{ID: id, Name: "project-" + rand.Text(), PreviewOrigins: []string{}}
}

// newTestTeam builds a persistable team.
func newTestTeam(projectID, id string) *domain.Team {
	return &domain.Team{ProjectID: projectID, ID: id, Name: "team-" + rand.Text()}
}

func projectIDs(projects []*domain.Project) []string {
	ids := make([]string, len(projects))
	for i, p := range projects {
		ids[i] = p.ID
	}
	return ids
}
