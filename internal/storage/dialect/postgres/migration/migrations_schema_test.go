//go:build postgres_integration

package migration_test

import (
	"context"
	"crypto/rand"
	"database/sql"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	_ "github.com/jackc/pgx/v5/stdlib" // registers the "pgx" database/sql driver used for migrations
	migrationpkg "github.com/zitadel/nextgen/internal/storage/dialect/postgres/migration"
	"github.com/zitadel/nextgen/internal/storage/testdb"
)

func TestMigrateIntoAppliesSchemaIdempotently(t *testing.T) {
	ctx := t.Context()

	dsn, stop, err := testdb.PostgresDSN(ctx)
	require.NoError(t, err)
	t.Cleanup(stop)

	db, err := sql.Open("pgx", dsn)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	schema := "s_" + strings.ToLower(rand.Text())
	t.Cleanup(func() {
		_, err := db.ExecContext(context.Background(), "DROP SCHEMA IF EXISTS "+schema+" CASCADE")
		assert.NoError(t, err)
	})

	for range 2 {
		require.NoError(t, migrationpkg.MigrateInto(ctx, db, schema))
	}

	var tables int
	require.NoError(t, db.QueryRowContext(ctx,
		"SELECT count(*) FROM information_schema.tables WHERE table_schema = $1 AND table_name IN ('projects', 'users', 'goose_db_version')",
		schema,
	).Scan(&tables))
	assert.Equal(t, 3, tables, "the tables and the goose tracking table live in the schema")

	var extensionSchema string
	require.NoError(t, db.QueryRowContext(ctx,
		"SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pgcrypto'",
	).Scan(&extensionSchema))
	assert.Equal(t, "public", extensionSchema, "extensions are shared by every schema of the database")

	// The connection above carries no search_path, so this also proves that
	// the migrations qualify every object they create: nothing may land in
	// public, which is what a `schema=` DSN through a pooler relies on.
	var inPublic int
	require.NoError(t, db.QueryRowContext(ctx,
		"SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'i', 'S', 'v')",
	).Scan(&inPublic))
	assert.Zero(t, inPublic, "no table, index, sequence or view may be created in public")

	assert.Error(t, migrationpkg.MigrateInto(ctx, db, "Not Valid"))
}
