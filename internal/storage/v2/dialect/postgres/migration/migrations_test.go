//go:build postgres_integration

package migration_test

import (
	"database/sql"
	"os"
	"testing"

	"github.com/stretchr/testify/require"

	_ "github.com/jackc/pgx/v5/stdlib" // registers the "pgx" database/sql driver used for migrations
	v2embeddedpostgres "github.com/zitadel/nextgen/internal/storage/v2/dialect/postgres/embedded"
	migrationpkg "github.com/zitadel/nextgen/internal/storage/v2/dialect/postgres/migration"
)

func TestMigrateSupportsSingleConnectionPool(t *testing.T) {
	ctx := t.Context()

	var (
		dsn  string
		stop func() = func() {}
	)
	if url := os.Getenv("ZITADEL_TEST_POSTGRES_URL"); url != "" {
		dsn = url
	} else {
		var stopFn func()
		var err error
		_, dsn, stopFn, err = v2embeddedpostgres.StartContainerWithDSN(ctx)
		require.NoError(t, err)
		stop = stopFn
	}
	t.Cleanup(stop)

	db, err := sql.Open("pgx", dsn)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	require.NoError(t, migrationpkg.Migrate(ctx, db))
}
