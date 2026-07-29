//go:build postgres_integration || spanner_integration

package dbtest

import (
	"context"
	"os"

	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
	v2embeddedpostgres "github.com/zitadel/nextgen/internal/storage/v2/dialect/postgres/embedded"
	v2postgres "github.com/zitadel/nextgen/internal/storage/v2/dialect/postgres"
)

// Postgres returns a connected v2 pool for the Postgres integration tests.
// If ZITADEL_TEST_POSTGRES_URL is set, it connects to that database (no Docker
// required); otherwise it starts a Postgres testcontainer. The returned stop
// function is always non-nil and safe to defer.
func Postgres(ctx context.Context) (v2database.Pool, func(), error) {
	if url := os.Getenv("ZITADEL_TEST_POSTGRES_URL"); url != "" {
		dialect, err := v2postgres.DecodeConfig(url)
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

	pool, stop, err := v2embeddedpostgres.StartContainer(ctx)
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

