//go:build postgres_integration || spanner_integration

package repository_test

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
	slogctx "github.com/veqryn/slog-context"
	storagedb "github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dbtest"
	v1postgres "github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
	spannerDialect "github.com/zitadel/nextgen/internal/storage/database/dialect/spanner"
	v2postgres "github.com/zitadel/nextgen/internal/storage/v2/dialect/postgres"
	v2spanner "github.com/zitadel/nextgen/internal/storage/v2/dialect/spanner"
)

func TestMain(m *testing.M) {
	os.Exit(runTests(m))
}

var (
	pool        storagedb.PoolTest
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

	if err != nil {
		slog.Error("error setting up test database", slogctx.Err(err))
		if stop != nil {
			stop()
		}
		return 1
	}
	defer func() {
		r := recover()
		if pool != nil {
			pool.Close(ctx)
		}
		if stop != nil {
			stop()
		}
		if r != nil {
			panic(r)
		}
	}()

	return m.Run()
}

func newSpannerURLDB(ctx context.Context, url string) (storagedb.PoolTest, func(), error) {
	isSpannerDB = true
	connector, err := spannerDialect.DecodeConfig(url)
	if err != nil {
		return nil, func() {}, fmt.Errorf("unable to decode Spanner config: %w", err)
	}
	pool_, err := connector.Connect(ctx)
	if err != nil {
		return nil, func() {}, fmt.Errorf("unable to connect to Spanner: %w", err)
	}
	wrapped := v2spanner.WrapPool(pool_)
	if err = wrapped.MigrateTest(ctx); err != nil {
		return nil, func() { wrapped.Close(ctx) }, fmt.Errorf("unable to migrate Spanner: %w", err)
	}
	return wrapped, func() { wrapped.Close(ctx) }, nil
}

func newEmbeddedDB(ctx context.Context) (storagedb.PoolTest, func(), error) {
	connector, stop, err := dbtest.Postgres(ctx)
	if err != nil {
		return nil, stop, fmt.Errorf("unable to start postgres: %w", err)
	}

	pool_, err := connector.Connect(ctx)
	if err != nil {
		return nil, stop, fmt.Errorf("unable to connect to postgres: %w", err)
	}
	pgPool, ok := pool_.(*v1postgres.Pool)
	if !ok {
		return nil, stop, fmt.Errorf("expected postgres pool, got %T", pool_)
	}
	wrapped := v2postgres.WrapPool(pgPool)
	if err = wrapped.MigrateTest(ctx); err != nil {
		return nil, func() {
			wrapped.Close(ctx)
			stop()
		}, fmt.Errorf("unable to migrate database: %w", err)
	}
	return wrapped, stop, nil
}

func transactionForRollback(t *testing.T) (tx storagedb.Transaction, rollback func()) {
	t.Helper()
	tx, err := pool.Begin(t.Context(), nil)
	require.NoError(t, err)
	return tx, func() {
		err := tx.Rollback(context.Background())
		require.NoError(t, err)
	}
}
