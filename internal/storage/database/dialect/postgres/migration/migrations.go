package migration

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"

	"github.com/pressly/goose/v3"
)

//go:embed sql/*.sql
var sqlFiles embed.FS

const schemaName = "zitadel_nextgen"

// migrationLockID keys the session advisory lock that serializes Migrate
// across all connections and processes sharing one database. Arbitrary but
// stable: "zitadel" in hex.
const migrationLockID = int64(0x7a69746164656c)

// Migrate applies all pending migrations to db. It is idempotent: already-applied
// migrations are skipped. The zitadel_nextgen schema is created if it does not exist,
// since the goose tracking table lives there.
//
// Concurrent callers — parallel test packages sharing one database, or several
// nodes starting at once — are serialized with a session advisory lock held
// across both the schema creation and goose's run: two concurrent goose runs
// can each see a migration as pending and race its DDL (CREATE TYPE has no IF
// NOT EXISTS, so the loser fails on pg_type's unique index). The lock is held
// on a dedicated connection while goose runs on the pool, so db must allow at
// least two open connections.
func Migrate(ctx context.Context, db *sql.DB) (err error) {
	conn, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, conn.Close()) }()

	if _, err := conn.ExecContext(ctx, "SELECT pg_advisory_lock($1)", migrationLockID); err != nil {
		return fmt.Errorf("acquire migration advisory lock: %w", err)
	}
	defer func() {
		// Release on the same session before Close pools it again: a pooled
		// session keeps its advisory locks. WithoutCancel so a canceled ctx
		// cannot skip the release.
		_, unlockErr := conn.ExecContext(context.WithoutCancel(ctx), "SELECT pg_advisory_unlock($1)", migrationLockID)
		err = errors.Join(err, unlockErr)
	}()

	if _, err := conn.ExecContext(ctx, "CREATE SCHEMA IF NOT EXISTS "+schemaName); err != nil {
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
	_, err = p.Up(ctx)
	return err
}
