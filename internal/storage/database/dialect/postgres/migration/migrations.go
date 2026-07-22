package migration

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"

	"github.com/pressly/goose/v3"
)

//go:embed sql/*.sql
var sqlFiles embed.FS

const schemaName = "zitadel_nextgen"

// migrationLockID keys the transaction-scoped advisory lock that serializes
// Migrate across all connections and processes sharing one database.
// Arbitrary but stable: "zitadel" in hex.
const migrationLockID = int64(0x7a69746164656c)

// Migrate applies all pending migrations to db. It is idempotent: already-applied
// migrations are skipped. The zitadel_nextgen schema is created if it does not exist,
// since the goose tracking table lives there.
//
// Concurrent callers — parallel test packages sharing one database, or several
// nodes starting at once — are serialized with pg_advisory_xact_lock held
// across both the schema creation and goose's run: two concurrent goose runs
// can each see a migration as pending and race its DDL (CREATE TYPE has no IF
// NOT EXISTS, so the loser fails on pg_type's unique index). The lock lives in
// a dedicated transaction, so however Migrate ends — commit, rollback, or the
// process dying mid-run — the lock is released with it. The transaction pins
// one connection while goose runs on the pool, so db must allow at least two
// open connections.
func Migrate(ctx context.Context, db *sql.DB) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	// No-op after Commit; on every other path it ends the transaction and
	// releases the lock.
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock($1)", migrationLockID); err != nil {
		return fmt.Errorf("acquire migration advisory lock: %w", err)
	}

	// The schema must be created outside the lock transaction: goose runs on
	// other pool connections and only sees committed state.
	if _, err := db.ExecContext(ctx, "CREATE SCHEMA IF NOT EXISTS "+schemaName); err != nil {
		return err
	}
	sqlFS, err := fs.Sub(sqlFiles, "sql")
	if err != nil {
		return err
	}
	p, err := goose.NewProvider(goose.DialectPostgres, db, sqlFS,
		goose.WithTableName(schemaName+".goose_db_version"),
	)
	if err != nil {
		return err
	}
	if _, err := p.Up(ctx); err != nil {
		return err
	}
	return tx.Commit()
}
