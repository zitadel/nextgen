//go:build spanner_integration && !postgres_integration

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
	os.Exit(runSpanner(m))
}

func runSpanner(m *testing.M) int {
	ctx := context.Background()

	pool, stop, err := dbtest.Spanner(ctx)
	if err != nil {
		slog.Error("failed to start spanner test database", "error", err)
		if stop != nil {
			stop()
		}
		return 1
	}
	defer stop()
	defer pool.Close(ctx)

	svcPool, ok := pool.(service.Pool)
	if !ok {
		slog.Error("spanner pool does not implement service.Pool", "type", fmt.Sprintf("%T", pool))
		return 1
	}
	testPool = svcPool

	return m.Run()
}
