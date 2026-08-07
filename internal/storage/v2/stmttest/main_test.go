//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/dbtest"
)

type dialectOpener struct {
	name           string
	open           func(ctx context.Context) (dbtest.Pool, func(), error)
	seed           func(ctx context.Context, pool dbtest.Pool, ids []string, createdAt time.Time) error
	hardDeleteTeam func(ctx context.Context, pool dbtest.Pool, projectID, teamID string) error
}

// dialectOpeners is filled by build-tagged register files (postgres, spanner, and/or sqlite).
var dialectOpeners []dialectOpener

func registerDialect(
	name string,
	open func(ctx context.Context) (dbtest.Pool, func(), error),
	seed func(ctx context.Context, pool dbtest.Pool, ids []string, createdAt time.Time) error,
	hardDeleteTeam func(ctx context.Context, pool dbtest.Pool, projectID, teamID string) error,
) {
	dialectOpeners = append(dialectOpeners, dialectOpener{
		name: name, open: open, seed: seed, hardDeleteTeam: hardDeleteTeam,
	})
}

type dialect struct {
	name             string
	stmts            service.AllStatements
	seedTiedProjects func(ctx context.Context, ids []string, createdAt time.Time) error
	hardDeleteTeam   func(ctx context.Context, projectID, teamID string) error
}

// dialects is populated by TestMain for every registered opener.
var dialects []dialect

func TestMain(m *testing.M) {
	os.Exit(run(m))
}

func run(m *testing.M) int {
	ctx := context.Background()
	if len(dialectOpeners) == 0 {
		slog.Error("no dialects registered; build with postgres_integration, spanner_integration, and/or sqlite_integration")
		return 1
	}

	var stops []func()
	defer func() {
		for i := len(stops) - 1; i >= 0; i-- {
			stops[i]()
		}
	}()

	for _, opener := range dialectOpeners {
		pool, stop, err := opener.open(ctx)
		if err != nil {
			slog.Error("failed to start test database", "dialect", opener.name, "error", err)
			if stop != nil {
				stop()
			}
			return 1
		}
		stops = append(stops, stop)
		stops = append(stops, func() { _ = pool.Close(ctx) })

		seed := opener.seed
		hardDeleteTeam := opener.hardDeleteTeam
		dialects = append(dialects, dialect{
			name:  opener.name,
			stmts: pool.Statements(),
			seedTiedProjects: func(ctx context.Context, ids []string, createdAt time.Time) error {
				return seed(ctx, pool, ids, createdAt)
			},
			hardDeleteTeam: func(ctx context.Context, projectID, teamID string) error {
				return hardDeleteTeam(ctx, pool, projectID, teamID)
			},
		})
	}

	return m.Run()
}

// forEachDialect runs fn once per brought-up dialect as a subtest named after the dialect.
func forEachDialect(t *testing.T, fn func(t *testing.T, d dialect)) {
	t.Helper()
	require.NotEmpty(t, dialects)
	for _, d := range dialects {
		t.Run(d.name, func(t *testing.T) {
			fn(t, d)
		})
	}
}
