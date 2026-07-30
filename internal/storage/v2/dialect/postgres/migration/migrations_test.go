//go:build postgres_integration

package migration_test

import (
	"database/sql"
	"testing"

	"github.com/stretchr/testify/require"

	_ "github.com/jackc/pgx/v5/stdlib" // registers the "pgx" database/sql driver used for migrations
	migrationpkg "github.com/zitadel/nextgen/internal/storage/v2/dialect/postgres/migration"
	"github.com/zitadel/nextgen/internal/storage/v2/testdb"
)

func TestMigrateSupportsSingleConnectionPool(t *testing.T) {
	ctx := t.Context()

	dsn, stop, err := testdb.PostgresDSN(ctx)
	require.NoError(t, err)
	t.Cleanup(stop)

	db, err := sql.Open("pgx", dsn)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	require.NoError(t, migrationpkg.Migrate(ctx, db))
}
