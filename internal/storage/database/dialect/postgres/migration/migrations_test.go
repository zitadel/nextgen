//go:build postgres_integration

package migration_test

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dbtest"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres/migration"
)

func TestMigrateSupportsSingleConnectionPool(t *testing.T) {
	ctx := t.Context()
	connector, stop, err := dbtest.Postgres(ctx)
	require.NoError(t, err)
	t.Cleanup(stop)

	pool, err := connector.Connect(ctx)
	require.NoError(t, err)
	t.Cleanup(func() { _ = pool.Close(t.Context()) })

	testPool, ok := pool.(database.PoolTest)
	require.True(t, ok)
	db := testPool.RawDB()
	t.Cleanup(func() { _ = db.Close() })
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	require.NoError(t, migration.Migrate(ctx, db))
}
