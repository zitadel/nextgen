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
)

func TestMain(m *testing.M) {
	os.Exit(runTests(m))
}

var pool database.PoolTest

func runTests(m *testing.M) int {
	var stop func()
	var err error
	ctx := context.Background()
	pool, stop, err = newEmbeddedDB(ctx)
	defer stop()
	if err != nil {
		log.Printf("error with embedded postgres database: %v", err)
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

func savepointForRollback(t *testing.T, tx database.Transaction) (savepoint database.Transaction, rollback func()) {
	t.Helper()
	savepoint, err := tx.Begin(t.Context())
	require.NoError(t, err)
	return savepoint, func() {
		// context.Background to ensure rollback does not return an error if test is already done
		err := savepoint.Rollback(context.Background())
		require.NoError(t, err)
	}
}
