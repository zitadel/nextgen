//go:build postgres_integration

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

	connector, stop, err := dbtest.Postgres(ctx)
	if err != nil {
		slog.Error("setup: failed to start database", slogctx.Err(err))
		return 1
	}
	// Set after both branches so the ZITADEL_TEST_POSTGRES_URL path also wires
	// up the connector that helpers.EnsureDBPool dials.
	helpers.Connector = connector
	defer stop()

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
