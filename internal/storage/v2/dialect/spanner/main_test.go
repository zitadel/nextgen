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
	v2dbtest "github.com/zitadel/nextgen/internal/storage/v2/dbtest"
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

	pool, stop, err := v2dbtest.Spanner(ctx)
	if err != nil {
		return 1, err
	}
	defer stop()
	defer pool.Close(ctx)

	c, ok := pool.(*Client)
	if !ok {
		return 1, fmt.Errorf("expected *Client from the v2 spanner dialect, got %T", pool)
	}
	testClient = c

	return m.Run(), nil
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
