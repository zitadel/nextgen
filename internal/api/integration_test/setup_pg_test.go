//go:build postgres_integration

package integration_test

import (
	"context"
	"log/slog"
	"os"
	"testing"

	slogctx "github.com/veqryn/slog-context"
	"github.com/zitadel/nextgen/internal/service"
	v2dbtest "github.com/zitadel/nextgen/internal/storage/v2/dbtest"
)

func TestMain(m *testing.M) {
	os.Exit(runTests(m))
}

func runTests(m *testing.M) int {
	ctx := context.Background()

	pool, stop, err := v2dbtest.Postgres(ctx)
	if err != nil {
		slog.Error("setup: failed to start database", slogctx.Err(err))
		return 1
	}
	defer stop()
	defer pool.Close(ctx)

	v2, ok := pool.(service.Pool)
	if !ok {
		slog.Error("setup: pool does not implement v2 service.Pool", "type", pool)
		return 1
	}
	harness.DB = service.NewPool(v2)

	return m.Run()
}
