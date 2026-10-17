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
// with the round-trip smoke test, which walks the Down direction too.
func newProvider(sqlDB *sql.DB) (*goose.Provider, error) {
	sub, err := fs.Sub(sqlFS, "sql")
	if err != nil {
		return nil, err
	}
	return goose.NewProvider(goose.DialectSQLite3, sqlDB, sub)
}
