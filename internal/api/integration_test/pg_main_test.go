//go:build integration

package integration_test

import (
	"context"
	"log"
	"os"
	"testing"

	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres/embedded"
)

func TestMain(m *testing.M) {
	os.Exit(runTests(m))
}

func runTests(m *testing.M) int {
	ctx := context.Background()

	var err error
	var stop func()
	helpers.Connector, stop, err = embedded.StartEmbedded()
	if err != nil {
		log.Fatalf("failed to start database: %v", err)
		return 1
	}
	defer stop()

	pool, err := helpers.Connector.Connect(ctx)
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
		return 1
	}
	defer func() { _ = pool.Close(ctx) }()

	if err = pool.Migrate(ctx); err != nil {
		log.Fatalf("failed to migrate database: %v", err)
		return 1
	}

	return m.Run()
}
