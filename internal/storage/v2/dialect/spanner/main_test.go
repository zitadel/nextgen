//go:build spanner_integration

package spanner

import (
	"context"
	"crypto/rand"
	"database/sql"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database/dbtest"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/spanner"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/spanner/migration"
)

// testClient is a v2 spanner client connected to the migrated test database,
// shared across the tests in this package.
var testClient *Client

func TestMain(m *testing.M) {
	code, err := run(m)
	if err != nil {
		slog.Error("spanner test setup failed", "error", err)
	}
	os.Exit(code)
}

func run(m *testing.M) (int, error) {
	ctx := context.Background()

	connector, stop, err := dbtest.Spanner(ctx)
	if err != nil {
		return 1, err
	}
	defer stop()

	cfg, ok := connector.(*spanner.Config)
	if !ok {
		return 1, fmt.Errorf("expected *spanner.Config connector, got %T", connector)
	}

	db, err := sql.Open("spanner", cfg.DSN)
	if err != nil {
		return 1, err
	}
	defer db.Close()
	if err := migration.Migrate(ctx, db); err != nil {
		return 1, err
	}

	dialect, err := DecodeConfig(cfg.DSN)
	if err != nil {
		return 1, err
	}
	pool, err := dialect.Connect(ctx)
	if err != nil {
		return 1, err
	}
	defer pool.Close(ctx)

	c, ok := pool.(*Client)
	if !ok {
		return 1, fmt.Errorf("expected *Client from the v2 spanner dialect, got %T", pool)
	}
	testClient = c

	return m.Run(), nil
}

// uniqueSuffix builds a fixture suffix that is unique across calls
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

func newTestProject(id string) *domain.Project {
	return &domain.Project{ID: id, Name: "project-" + rand.Text(), PreviewOrigins: []string{}}
}

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
