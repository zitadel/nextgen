//go:build postgres_integration || spanner_integration

package stmttest

import (
	"context"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/zitadel/nextgen/internal/service"
)

// stmts is the dialect selected by openPool / TestMain.
var stmts service.AllStatements

// seedProjectsTiedAt inserts projects that share created_at (dialect DML).
var seedProjectsTiedAt func(ctx context.Context, ids []string, createdAt time.Time) error

func TestMain(m *testing.M) {
	os.Exit(run(m))
}

func run(m *testing.M) int {
	ctx := context.Background()

	pool, stop, err := openPool(ctx)
	if err != nil {
		slog.Error("failed to start test database", "error", err)
		if stop != nil {
			stop()
		}
		return 1
	}
	defer stop()
	defer pool.Close(ctx)

	stmts = pool.Statements()
	seedProjectsTiedAt = bindSeed(pool)

	return m.Run()
}
