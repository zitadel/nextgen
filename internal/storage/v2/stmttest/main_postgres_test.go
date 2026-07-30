//go:build postgres_integration && !spanner_integration

package stmttest

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"testing"

	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/dbtest"
)

func TestMain(m *testing.M) {
	os.Exit(runPostgres(m))
}

func runPostgres(m *testing.M) int {
	ctx := context.Background()

	pool, stop, err := dbtest.Postgres(ctx)
	if err != nil {
		slog.Error("failed to start postgres test database", "error", err)
		if stop != nil {
			stop()
		}
		return 1
	}
	defer stop()
	defer pool.Close(ctx)

	svcPool, ok := pool.(service.Pool)
	if !ok {
		slog.Error("postgres pool does not implement service.Pool", "type", fmt.Sprintf("%T", pool))
		return 1
	}
	testPool = svcPool

	return m.Run()
}
