//go:build postgres_integration

// Run: go test -tags=integration ./internal/service/... -run SessionService_Exchange_integration -count=1

package service_test

import (
	"context"
	"fmt"
	"log"
	"os"
	"testing"

	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres/embedded"
)

func TestMain(m *testing.M) {
	os.Exit(runPostgresIntegrationTests(m))
}

var integrationPool database.PoolTest

func runPostgresIntegrationTests(m *testing.M) int {
	ctx := context.Background()

	var stop func()
	var err error
	if url := os.Getenv("ZITADEL_TEST_POSTGRES_URL"); url != "" {
		log.Println("integration: using ZITADEL_TEST_POSTGRES_URL")
		connector, connErr := postgres.DecodeConfig(url)
		if connErr != nil {
			log.Printf("integration: decode postgres config: %v", connErr)
			return 1
		}
		stop = func() {}
		var pool_ database.Pool
		pool_, err = connector.Connect(ctx)
		if err == nil {
			integrationPool = pool_.(database.PoolTest)
		}
	} else {
		var connector database.Connector
		connector, stop, err = embedded.StartContainer(ctx)
		if err == nil {
			var pool_ database.Pool
			pool_, err = connector.Connect(ctx)
			if err == nil {
				integrationPool = pool_.(database.PoolTest)
			}
		}
	}

	if err != nil {
		log.Printf("integration: database setup failed: %v", err)
		return 1
	}

	defer func() {
		if integrationPool != nil {
			integrationPool.Close(ctx)
		}
		if stop != nil {
			stop()
		}
	}()

	if err = integrationPool.MigrateTest(ctx); err != nil {
		log.Printf("integration: migrate failed: %v", err)
		return 1
	}

	return m.Run()
}

func integrationPoolOrFail(t *testing.T) database.Pool {
	t.Helper()
	if integrationPool == nil {
		t.Fatal(fmt.Sprintf("integration pool not initialized; run with -tags=integration"))
	}
	return integrationPool
}
