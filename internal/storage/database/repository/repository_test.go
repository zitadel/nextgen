package repository_test

import (
	"context"
	"fmt"
	"log"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres/embedded"
	spannerDialect "github.com/zitadel/nextgen/internal/storage/database/dialect/spanner"
)

func TestMain(m *testing.M) {
	os.Exit(runTests(m))
}

var (
	pool        database.PoolTest
	isSpannerDB bool
)

func runTests(m *testing.M) int {
	var stop func()
	var err error
	ctx := context.Background()

	if spannerURL := os.Getenv("ZITADEL_TEST_SPANNER_URL"); spannerURL != "" {
		pool, stop, err = newSpannerURLDB(ctx, spannerURL)
	} else if useSpannerContainer() {
		pool, stop, err = newSpannerContainerDB(ctx)
	} else {
		pool, stop, err = newEmbeddedDB(ctx)
	}

	defer stop()
	if err != nil {
		log.Printf("error setting up test database: %v", err)
		return 1
	}
	defer func() {
		r := recover()
		pool.Close(ctx)
		stop()
		if r != nil {
			panic(r)
		}
	}()

	return m.Run()
}

func newSpannerURLDB(ctx context.Context, url string) (database.PoolTest, func(), error) {
	isSpannerDB = true
	log.Printf("using Spanner database at %s", url)
	connector, err := spannerDialect.DecodeConfig(url)
	if err != nil {
		return nil, func() {}, fmt.Errorf("unable to decode Spanner config: %w", err)
	}
	pool_, err := connector.Connect(ctx)
	if err != nil {
		return nil, func() {}, fmt.Errorf("unable to connect to Spanner: %w", err)
	}
	pool := pool_.(database.PoolTest)
	if err = pool.MigrateTest(ctx); err != nil {
		return nil, func() { pool.Close(ctx) }, fmt.Errorf("unable to migrate Spanner: %w", err)
	}
	return pool, func() { pool.Close(ctx) }, nil
}

func newEmbeddedDB(ctx context.Context) (pool database.PoolTest, stop func(), err error) {
	var connector database.Connector
	if url := os.Getenv("ZITADEL_TEST_POSTGRES_URL"); url != "" {
		log.Println("using database provided by env")
		connector, err = postgres.DecodeConfig(url)
		if err != nil {
			return nil, nil, fmt.Errorf("unable to connect to provided postgres: %w", err)
		}
		stop = func() {}
	} else {
		connector, stop, err = embedded.StartEmbedded()
		if err != nil {
			return nil, nil, fmt.Errorf("unable to start embedded postgres: %w", err)
		}
	}

	pool_, err := connector.Connect(ctx)
	if err != nil {
		return nil, stop, fmt.Errorf("unable to connect to embedded postgres: %w", err)
	}
	pool = pool_.(database.PoolTest)

	err = pool.MigrateTest(ctx)
	if err != nil {
		return nil, stop, fmt.Errorf("unable to migrate database: %w", err)
	}
	return pool, stop, err
}

func transactionForRollback(t *testing.T) (tx database.Transaction, rollback func()) {
	t.Helper()
	tx, err := pool.Begin(t.Context(), nil)
	require.NoError(t, err)
	return tx, func() {
		// context.Background to ensure rollback does not return an error if test is already done
		err := tx.Rollback(context.Background())
		require.NoError(t, err)
	}
}

// dbTable returns the dialect-correct table name.
// Postgres qualifies tables with the zitadel_nextgen schema; Spanner has no schemas.
func dbTable(name string) string {
	if isSpannerDB {
		return name
	}
	return "zitadel_nextgen." + name
}

// jsonCast returns "::json" for Postgres or empty string for Spanner.
func jsonCast() string {
	if isSpannerDB {
		return ""
	}
	return "::json"
}

func savepointForRollback(t *testing.T, tx database.Transaction) (savepoint database.Transaction, rollback func()) {
	t.Helper()
	savepoint, err := tx.Begin(t.Context(), nil)
	require.NoError(t, err)
	return savepoint, func() {
		// context.Background to ensure rollback does not return an error if test is already done
		err := savepoint.Rollback(context.Background())
		require.NoError(t, err)
	}
}
