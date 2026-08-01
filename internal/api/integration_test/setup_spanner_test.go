//go:build spanner_integration

package integration_test

import (
	"context"
	"log/slog"
	"os"
	"testing"

	slogctx "github.com/veqryn/slog-context"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/dbtest"
)

func TestMain(m *testing.M) {
	os.Exit(runTests(m))
}

func runTests(m *testing.M) int {
	ctx := context.Background()

	pool, stop, err := dbtest.Spanner(ctx)
	if err != nil {
		slog.Error("setup: failed to start Spanner database", slogctx.Err(err))
		return 1
	}
	defer stop()
	defer pool.Close(ctx)

	harness.DB = service.NewPool(pool)
	return m.Run()
}
