//go:build postgres_integration || spanner_integration

package dbtest

import (
	"context"

	v2postgres "github.com/zitadel/nextgen/internal/storage/dialect/postgres"
	"github.com/zitadel/nextgen/internal/storage/testdb"
)

// Postgres returns a connected v2 pool for the Postgres integration tests.
// Bring-up precedence is owned by testdb.PostgresDSN: a database of its own on
// the server ZITADEL_TEST_POSTGRES_SERVER_URL names, the database
// ZITADEL_TEST_POSTGRES_URL names (no Docker required for either), or a
// Postgres testcontainer. The returned stop function is always non-nil and
// safe to defer.
func Postgres(ctx context.Context) (Pool, func(), error) {
	dsn, stop, err := testdb.PostgresDSN(ctx)
	if err != nil {
		return nil, nil, err
	}

	dialect, err := v2postgres.DecodeConfig(dsn)
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
