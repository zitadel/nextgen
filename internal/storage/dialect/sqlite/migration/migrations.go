// Package migration applies SQLite schema migrations using goose.
package migration

import (
	"context"
	"database/sql"
	"embed"
	"io/fs"

	"github.com/pressly/goose/v3"
)

//go:embed sql
var sqlFS embed.FS

// PragmaQuery is the DSN query every dialect connection opens with. It lives
// here, below the dialect, so this package's tests open the database the way
// the dialect does.
//
// _txlock=immediate acquires the write lock at BEGIN so deferred read
// transactions cannot upgrade into SQLITE_BUSY_SNAPSHOT after another writer
// commits. busy_timeout covers remaining lock waits if MaxOpenConns is raised.
// Pragmas are applied via DSN so every opened connection gets them.
const PragmaQuery = "_txlock=immediate&_pragma=busy_timeout(30000)&_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=case_sensitive_like(1)"

// Migrate applies all pending migrations to db.
func Migrate(ctx context.Context, sqlDB *sql.DB) error {
	p, err := newProvider(sqlDB)
	if err != nil {
		return err
	}
	_, err = p.Up(ctx)
	return err
}

// newProvider builds the goose provider over the embedded migrations. Shared
// with the round-trip test, which walks the Down direction too.
func newProvider(sqlDB *sql.DB) (*goose.Provider, error) {
	sub, err := fs.Sub(sqlFS, "sql")
	if err != nil {
		return nil, err
	}
	return goose.NewProvider(goose.DialectSQLite3, sqlDB, sub)
}
