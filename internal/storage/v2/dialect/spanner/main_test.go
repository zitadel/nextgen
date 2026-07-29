//go:build spanner_integration

package spanner

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

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database/dbtest"
	v1spanner "github.com/zitadel/nextgen/internal/storage/database/dialect/spanner"
)

// testClient is a v2 spanner client connected to the migrated test database,
// shared across the tests in this package.
//
// Container/DSN bring-up still uses v1 dbtest (importing v2/dbtest from this
// package would cycle: spanner → v2/dbtest → spanner). Schema migration runs
// via the v2 pool's Migrate method.
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

	dsn, stop, err := spannerTestDSN(ctx)
	if err != nil {
		return 1, err
	}
	defer stop()

	dialect, err := DecodeConfig(dsn)
	if err != nil {
		return 1, err
	}
	pool, err := dialect.Connect(ctx)
	if err != nil {
		return 1, err
	}
	defer pool.Close(ctx)

	if err := pool.Migrate(ctx); err != nil {
		return 1, err
	}

	c, ok := pool.(*Client)
	if !ok {
		return 1, fmt.Errorf("expected *Client from the v2 spanner dialect, got %T", pool)
	}
	testClient = c

	return m.Run(), nil
}

func spannerTestDSN(ctx context.Context) (string, func(), error) {
	if url := os.Getenv("ZITADEL_TEST_SPANNER_URL"); url != "" {
		return url, func() {}, nil
	}
	connector, stop, err := dbtest.Spanner(ctx)
	if err != nil {
		return "", stop, err
	}
	if stop == nil {
		stop = func() {}
	}
	cfg, ok := connector.(*v1spanner.Config)
	if !ok {
		stop()
		return "", nil, fmt.Errorf("expected *spanner.Config connector, got %T", connector)
	}
	return cfg.DSN, stop, nil
}

// uniqueProjectID returns a collision-free project ID scoped to the running
// (sub)test. The v2 statements commit immediately (no rollback), so isolation
// relies on unique IDs plus DeleteProjectByID cleanup rather than a transaction.
func uniqueProjectID(t *testing.T) string {
	t.Helper()
	return "proj-" + strings.ReplaceAll(t.Name(), "/", "_") + "-" + strconv.FormatInt(time.Now().UnixNano(), 10)
}

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
