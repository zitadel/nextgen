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
// nodes starting at once — are serialized with the same session advisory lock
// for schema creation and goose's run: two concurrent goose runs can each see
// a migration as pending and race its DDL (CREATE TYPE has no IF NOT EXISTS, so
// the loser fails on pg_type's unique index). Goose runs SQL migrations on the
// locked connection, so single-connection pools remain supported.
func Migrate(ctx context.Context, db *sql.DB) (err error) {
	locker := migrationSessionLocker{}
	if err := createSchema(ctx, db, locker); err != nil {
		return err
	}

	sqlFS, err := fs.Sub(sqlFiles, "sql")
	if err != nil {
		return err
	}
	p, err := goose.NewProvider(goose.DialectPostgres, db, sqlFS,
		goose.WithTableName(schemaName+".goose_db_version"),
		goose.WithSessionLocker(locker),
	)
	if err != nil {
		return err
	}
	_, err = p.Up(ctx)
	return err
}

// createSchema bootstraps the schema under the same advisory lock goose uses.
// It releases the connection before goose acquires its migration connection,
// which lets a pool limited to one open connection make progress.
func createSchema(ctx context.Context, db *sql.DB, locker migrationSessionLocker) (err error) {
	conn, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, conn.Close()) }()

	if err := locker.SessionLock(ctx, conn); err != nil {
		return err
	}
	defer func() {
		err = errors.Join(err, locker.SessionUnlock(context.WithoutCancel(ctx), conn))
	}()

	if _, err := conn.ExecContext(ctx, "CREATE SCHEMA IF NOT EXISTS "+schemaName); err != nil {
		return err
	}
	return nil
}

// migrationSessionLocker lets goose hold the advisory lock on the same
// *sql.Conn it uses for version checks and SQL migrations.
type migrationSessionLocker struct{}

func (migrationSessionLocker) SessionLock(ctx context.Context, conn *sql.Conn) error {
	if _, err := conn.ExecContext(ctx, "SELECT pg_advisory_lock($1)", migrationLockID); err != nil {
		return fmt.Errorf("acquire migration advisory lock: %w", err)
	}
	return nil
}

func (migrationSessionLocker) SessionUnlock(ctx context.Context, conn *sql.Conn) error {
	var unlocked bool
	if err := conn.QueryRowContext(ctx, "SELECT pg_advisory_unlock($1)", migrationLockID).Scan(&unlocked); err != nil {
		return fmt.Errorf("release migration advisory lock: %w", err)
	}
	if !unlocked {
		return errors.New("release migration advisory lock: lock was not held by this session")
	}
	return nil
}
