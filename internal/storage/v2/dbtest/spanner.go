//go:build spanner_integration

package dbtest

import (
	"context"
	"os"

	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
	v2spannerdialect "github.com/zitadel/nextgen/internal/storage/v2/dialect/spanner"
	v2embeddedspanner "github.com/zitadel/nextgen/internal/storage/v2/dialect/spanner/embedded"
)

// Spanner returns a connected v2 pool for the Spanner integration tests.
// If ZITADEL_TEST_SPANNER_URL is set, it connects to that database (no
// Docker required); otherwise it starts a Cloud Spanner emulator
// testcontainer. The returned stop function is always non-nil and safe to
// defer.
func Spanner(ctx context.Context) (v2database.Pool, func(), error) {
	if url := os.Getenv("ZITADEL_TEST_SPANNER_URL"); url != "" {
		dialect, err := v2spannerdialect.DecodeConfig(url)
		if err != nil {
			return nil, nil, err
		}
		pool, err := dialect.Connect(ctx)
		if err != nil {
			return nil, nil, err
		}
		if err := pool.Migrate(ctx); err != nil {
			_ = pool.Close(ctx)
			return nil, nil, err
		}
		return pool, func() {}, nil
	}

	pool, stop, err := v2embeddedspanner.StartEmbedded(ctx)
	if err != nil {
		return nil, nil, err
	}
	if err := pool.Migrate(ctx); err != nil {
		_ = pool.Close(ctx)
		stop()
		return nil, nil, err
	}
	return pool, stop, nil
}
