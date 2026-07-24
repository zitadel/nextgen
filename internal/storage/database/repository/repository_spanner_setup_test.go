//go:build spanner_integration

package repository_test

import (
	"context"
	"fmt"
	"os"

	"github.com/zitadel/nextgen/internal/storage/database"
	spannerEmbedded "github.com/zitadel/nextgen/internal/storage/database/dialect/spanner/embedded"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/spanner/testdb"
)

func useSpannerContainer() bool { return true }

// useSpannerInstance reports whether a shared Spanner test instance is
// configured; when set it takes precedence over the emulator container.
func useSpannerInstance() bool { return os.Getenv(testdb.InstanceEnv) != "" }

// newSpannerInstanceDB provisions a fresh database on the shared test instance,
// migrates it, and returns a stop func that drops the database and closes the
// pool.
func newSpannerInstanceDB(ctx context.Context) (database.PoolTest, func(), error) {
	isSpannerDB = true
	connector, drop, err := testdb.Provision(ctx)
	if err != nil {
		return nil, func() {}, err
	}
	pool_, err := connector.Connect(ctx)
	if err != nil {
		drop()
		return nil, func() {}, fmt.Errorf("unable to connect to Spanner instance: %w", err)
	}
	pool := pool_.(database.PoolTest)
	if err = pool.MigrateTest(ctx); err != nil {
		pool.Close(ctx)
		drop()
		return nil, func() {}, fmt.Errorf("unable to migrate Spanner instance: %w", err)
	}
	return pool, func() {
		pool.Close(ctx)
		drop()
	}, nil
}

func newSpannerContainerDB(ctx context.Context) (database.PoolTest, func(), error) {
	isSpannerDB = true
	connector, stop, err := spannerEmbedded.StartEmbedded(ctx)
	if err != nil {
		return nil, func() {}, err
	}
	pool_, err := connector.Connect(ctx)
	if err != nil {
		stop()
		return nil, func() {}, fmt.Errorf("unable to connect to Spanner container: %w", err)
	}
	pool := pool_.(database.PoolTest)
	if err = pool.MigrateTest(ctx); err != nil {
		stop()
		return nil, func() {}, fmt.Errorf("unable to migrate Spanner container: %w", err)
	}
	return pool, stop, nil
}
