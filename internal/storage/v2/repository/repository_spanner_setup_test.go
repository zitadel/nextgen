//go:build spanner_integration

package repository_test

import (
	"context"
	"fmt"

	storagedb "github.com/zitadel/nextgen/internal/storage/database"
	spannerEmbedded "github.com/zitadel/nextgen/internal/storage/database/dialect/spanner/embedded"
	v2spanner "github.com/zitadel/nextgen/internal/storage/v2/dialect/spanner"
)

func useSpannerContainer() bool { return true }

func newSpannerContainerDB(ctx context.Context) (storagedb.PoolTest, func(), error) {
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
	wrapped := v2spanner.WrapPool(pool_)
	if err = wrapped.MigrateTest(ctx); err != nil {
		stop()
		return nil, func() {}, fmt.Errorf("unable to migrate Spanner container: %w", err)
	}
	return wrapped, stop, nil
}
