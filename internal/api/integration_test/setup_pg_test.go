//go:build postgres_integration

package integration_test

import (
	"context"
	"log"
	"os"
	"testing"

	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres/embedded"
)

var testPool database.PoolTest

func TestMain(m *testing.M) {
	os.Exit(runTests(m))
}

func runTests(m *testing.M) int {
	ctx := context.Background()

	var (
		connector database.Connector
		stop      func()
		err       error
	)

	if url := os.Getenv("ZITADEL_TEST_POSTGRES_URL"); url != "" {
		log.Println("using Postgres database provided by env")
		connector, err = postgres.DecodeConfig(url)
		stop = func() {}
	} else {
		connector, stop, err = embedded.StartContainer(ctx)
	}
	if err != nil {
		log.Printf("setup: failed to start database: %v", err)
		return 1
	}
	// Set after both branches so the ZITADEL_TEST_POSTGRES_URL path also wires
	// up the connector that helpers.EnsureDBPool dials.
	helpers.Connector = connector
	defer stop()

	pool, err := connector.Connect(ctx)
	if err != nil {
		log.Printf("setup: failed to connect: %v", err)
		return 1
	}
	testPool = pool.(database.PoolTest)
	defer testPool.Close(ctx)

	if err = testPool.MigrateTest(ctx); err != nil {
		log.Printf("setup: migration failed: %v", err)
		return 1
	}

	return m.Run()
}
