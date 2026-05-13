//go:build spanner_integration

package repository_test

import (
	"context"
	"fmt"

	"github.com/zitadel/nextgen/internal/storage/database"
	spannerEmbedded "github.com/zitadel/nextgen/internal/storage/database/dialect/spanner/embedded"
)

func useSpannerContainer() bool { return true }

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
