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
	sub, err := fs.Sub(sqlFS, "sql")
	if err != nil {
		return err
	}
	p, err := goose.NewProvider(goose.DialectSQLite3, sqlDB, sub)
	if err != nil {
		return err
	}
	_, err = p.Up(ctx)
	return err
}
