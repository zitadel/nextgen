//go:build postgres_integration

package migration

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/storage/migrationtest"
	"github.com/zitadel/nextgen/internal/storage/testdb"
)

// TestMigrationsRoundTrip proves every Down restores the schema its Up
// started from, and that the Up applies again after it; see
// [migrationtest.RoundTrip].
func TestMigrationsRoundTrip(t *testing.T) {
	ctx := t.Context()
	db := roundTripDB(t)

	require.NoError(t, createSchema(ctx, db, migrationSessionLocker{}))
	p, err := newProvider(db)
	require.NoError(t, err)

	migrationtest.RoundTrip(t, p, func(t *testing.T) migrationtest.Schema {
		return snapshot(t, db)
	}, nil)
}

// roundTripDB opens a database of the test's own: the walk tears the schema
// down, which a database shared with other packages cannot afford. Against
// ZITADEL_TEST_POSTGRES_URL it creates one on that server and drops it after;
// otherwise it starts a container.
func roundTripDB(t *testing.T) *sql.DB {
	t.Helper()
	ctx := t.Context()

	shared := os.Getenv("ZITADEL_TEST_POSTGRES_URL")
	if shared == "" {
		dsn, stop, err := testdb.PostgresDSN(ctx)
		require.NoError(t, err)
		t.Cleanup(stop)
		db, err := sql.Open("pgx", dsn)
		require.NoError(t, err)
		t.Cleanup(func() { _ = db.Close() })
		return db
	}

	cfg, err := pgx.ParseConfig(shared)
	require.NoError(t, err)
	admin := stdlib.OpenDB(*cfg)
	t.Cleanup(func() { _ = admin.Close() })

	b := make([]byte, 4)
	_, _ = rand.Read(b)
	name := "zitadel_roundtrip_" + hex.EncodeToString(b)
	if _, err := admin.ExecContext(ctx, "CREATE DATABASE "+name); err != nil {
		t.Skipf("ZITADEL_TEST_POSTGRES_URL cannot create the throwaway database the round trip needs: %v", err)
	}
	t.Cleanup(func() {
		// t.Context is already canceled by the time cleanups run.
		_, err := admin.ExecContext(context.Background(), "DROP DATABASE "+name+" WITH (FORCE)")
		require.NoError(t, err)
	})

	own := cfg.Copy()
	own.Database = name
	db := stdlib.OpenDB(*own)
	// Registered after the DROP, so it runs first: close before dropping.
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// snapshot reads every object the migrations own in the zitadel_nextgen
// schema from the catalogs. Extensions are left out: CREATE EXTENSION is
// database-wide, so no Down drops one another schema might use. Column order
// is not compared either; a Down that re-adds a dropped column can only
// append it.
func snapshot(t *testing.T, db *sql.DB) migrationtest.Schema {
	t.Helper()
	s := migrationtest.Schema{}

	for _, r := range migrationtest.Rows(t, db, `
		SELECT table_name, table_type FROM information_schema.tables
		WHERE table_schema = $1 AND table_name <> 'goose_db_version'`, SchemaName) {
		s.Add(t, migrationtest.Key("table", r[0]), r[1])
	}
	for _, r := range migrationtest.Rows(t, db, `
		SELECT table_name, column_name,
			format_type(a.atttypid, a.atttypmod), is_nullable, column_default, is_identity, is_generated, generation_expression
		FROM information_schema.columns c
		JOIN pg_attribute a ON a.attrelid = format('%I.%I', c.table_schema, c.table_name)::regclass AND a.attname = c.column_name
		WHERE table_schema = $1 AND table_name <> 'goose_db_version'`, SchemaName) {
		s.Add(t, migrationtest.Key("column", r[0], r[1]),
			r[2]+" nullable="+r[3]+" default="+r[4]+" identity="+r[5]+" generated="+r[6]+" "+r[7])
	}
	for _, r := range migrationtest.Rows(t, db, `
		SELECT rel.relname, con.conname, pg_get_constraintdef(con.oid)
		FROM pg_constraint con
		JOIN pg_class rel ON rel.oid = con.conrelid
		JOIN pg_namespace n ON n.oid = rel.relnamespace
		WHERE n.nspname = $1 AND rel.relname <> 'goose_db_version'`, SchemaName) {
		s.Add(t, migrationtest.Key("constraint", r[0], r[1]), r[2])
	}
	for _, r := range migrationtest.Rows(t, db, `
		SELECT indexname, indexdef FROM pg_indexes
		WHERE schemaname = $1 AND tablename <> 'goose_db_version'`, SchemaName) {
		s.Add(t, migrationtest.Key("index", r[0]), r[1])
	}
	for _, r := range migrationtest.Rows(t, db, `
		SELECT t.typname, t.typtype, format_type(t.typbasetype, t.typtypmod),
			coalesce(string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder), '')
		FROM pg_type t
		JOIN pg_namespace n ON n.oid = t.typnamespace
		LEFT JOIN pg_enum e ON e.enumtypid = t.oid
		WHERE n.nspname = $1 AND t.typtype IN ('e', 'd')
		GROUP BY t.oid, t.typname, t.typtype, t.typbasetype, t.typtypmod`, SchemaName) {
		s.Add(t, migrationtest.Key("type", r[0]), r[1]+" "+r[2]+" "+r[3])
	}
	for _, r := range migrationtest.Rows(t, db, `
		SELECT p.oid::regprocedure::text, pg_get_functiondef(p.oid)
		FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
		WHERE n.nspname = $1`, SchemaName) {
		s.Add(t, migrationtest.Key("function", r[0]), r[1])
	}
	for _, r := range migrationtest.Rows(t, db, `
		SELECT tg.tgname, pg_get_triggerdef(tg.oid)
		FROM pg_trigger tg
		JOIN pg_class rel ON rel.oid = tg.tgrelid
		JOIN pg_namespace n ON n.oid = rel.relnamespace
		WHERE n.nspname = $1 AND NOT tg.tgisinternal`, SchemaName) {
		s.Add(t, migrationtest.Key("trigger", r[0]), r[1])
	}
	for _, r := range migrationtest.Rows(t, db, `
		SELECT viewname, definition FROM pg_views WHERE schemaname = $1`, SchemaName) {
		s.Add(t, migrationtest.Key("view", r[0]), r[1])
	}
	for _, r := range migrationtest.Rows(t, db, `
		SELECT sequencename, data_type::text, increment_by FROM pg_sequences WHERE schemaname = $1`, SchemaName) {
		s.Add(t, migrationtest.Key("sequence", r[0]), r[1]+" by "+r[2])
	}
	return s
}
