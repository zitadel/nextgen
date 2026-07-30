//go:build postgres_integration

// Run: go test -tags=postgres_integration ./internal/service/... -run SessionService_Exchange_integration -count=1

package service_test

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
	os.Exit(runPostgresIntegrationTests(m))
}

var integrationPool *service.DB

func runPostgresIntegrationTests(m *testing.M) int {
	ctx := context.Background()

	pool, stop, err := dbtest.Postgres(ctx)
	if err != nil {
		slog.Error("integration: database setup failed", slogctx.Err(err))
		return 1
	}
	defer stop()
	defer pool.Close(ctx)

	integrationPool = service.NewPool(pool)
	return m.Run()
}

func integrationPoolOrFail(t *testing.T) *service.DB {
	t.Helper()
	if integrationPool == nil {
		t.Fatalf("integration pool not initialized; run with -tags=postgres_integration")
	}
	return integrationPool
}
