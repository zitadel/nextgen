//go:build postgres_integration

// Run: go test -tags=postgres_integration ./internal/service/... -run SessionService_Exchange_integration -count=1

package service_test

import (
	"context"
	"log/slog"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	slogctx "github.com/veqryn/slog-context"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dbtest"
	pgold "github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres/embedded"
	v2postgres "github.com/zitadel/nextgen/internal/storage/v2/dialect/postgres"
)

func TestMain(m *testing.M) {
	os.Exit(runPostgresIntegrationTests(m))
}

var integrationPool database.PoolTest

func runPostgresIntegrationTests(m *testing.M) int {
	ctx := context.Background()

	connector, stop, err := dbtest.Postgres(ctx)
	if err != nil {
		slog.Error("integration: database setup failed", slogctx.Err(err))
		return 1
	}
	defer stop()

	pool, err := connector.Connect(ctx)
	if err != nil {
		slog.Error("integration: connect failed", slogctx.Err(err))
		return 1
	}
	integrationPool = pool.(database.PoolTest)
	defer integrationPool.Close(ctx)

	if err = integrationPool.MigrateTest(ctx); err != nil {
		slog.Error("integration: migrate failed", slogctx.Err(err))
		return 1
	}

	return m.Run()
}

func integrationPoolOrFail(t *testing.T) database.Pool {
	t.Helper()
	if integrationPool == nil {
		t.Fatalf("integration pool not initialized; run with -tags=postgres_integration")
	}
	return integrationPool
}

func integrationV2PoolOrFail(t *testing.T) *service.DB {
	t.Helper()
	pool := integrationPoolOrFail(t)
	var pgxPool *pgxpool.Pool
	switch p := pool.(type) {
	case *embedded.Pool:
		pgxPool = p.Pool.Pool
	case *pgold.Pool:
		pgxPool = p.Pool
	default:
		t.Fatalf("unsupported integration pool type %T", pool)
	}
	v2, err := (&v2postgres.PoolConfig{Pool: pgxPool}).Connect(t.Context())
	if err != nil {
		t.Fatalf("v2 pool: %v", err)
	}
	return service.NewPool(v2.(service.Pool))
}
