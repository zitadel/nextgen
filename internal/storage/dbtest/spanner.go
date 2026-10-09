//go:build spanner_integration

package dbtest

import (
	"context"

	v2spannerdialect "github.com/zitadel/nextgen/internal/storage/dialect/spanner"
	"github.com/zitadel/nextgen/internal/storage/testdb"
)

// Spanner returns a connected v2 pool for the Spanner integration tests.
// Bring-up precedence is owned by testdb.SpannerDSN. The returned stop
// function is always non-nil and safe to defer.
func Spanner(ctx context.Context) (Pool, func(), error) {
	dsn, stop, err := testdb.SpannerDSN(ctx)
	if err != nil {
		return nil, nil, err
	}

	dialect, err := v2spannerdialect.DecodeConfig(dsn)
	if err != nil {
		stop()
		return nil, nil, err
	}
	pool, err := dialect.Connect(ctx)
	if err != nil {
		stop()
		return nil, nil, err
	}
	if err := pool.Migrate(ctx); err != nil {
		_ = pool.Close(ctx)
		stop()
		return nil, nil, err
	}
	out, err := asPool(pool)
	if err != nil {
		_ = pool.Close(ctx)
		stop()
		return nil, nil, err
	}
	return out, stop, nil
}
