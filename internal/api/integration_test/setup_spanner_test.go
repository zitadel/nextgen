//go:build spanner_integration

package integration_test

import (
	"context"
	"log/slog"
	"os"
	"testing"

	slogctx "github.com/veqryn/slog-context"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dbtest"
)

var testPool database.PoolTest

func TestMain(m *testing.M) {
	os.Exit(runTests(m))
}

func runTests(m *testing.M) int {
	ctx := context.Background()

	connector, stop, err := dbtest.Spanner(ctx)
	if err != nil {
		slog.Error("setup: failed to start Spanner database", slogctx.Err(err))
		return 1
	}
	defer stop()
	helpers.Connector = connector

	pool, err := connector.Connect(ctx)
	if err != nil {
		slog.Error("setup: failed to connect", slogctx.Err(err))
		return 1
	}
	testPool = pool.(database.PoolTest)
	defer testPool.Close(ctx)

	if err = testPool.MigrateTest(ctx); err != nil {
		slog.Error("setup: migration failed", slogctx.Err(err))
		return 1
	}

	return m.Run()
}
