package migration

import (
	"context"
	"database/sql"
	"embed"
	"io/fs"

	"github.com/pressly/goose/v3"
)

//go:embed sql/*.sql
var sqlFiles embed.FS

func Migrate(ctx context.Context, db *sql.DB) error {
	sqlFS, err := fs.Sub(sqlFiles, "sql")
	if err != nil {
		return err
	}
	// WithIsolateDDL runs DDL statements outside transactions, which Spanner requires.
	p, err := goose.NewProvider(goose.DialectSpanner, db, sqlFS, goose.WithIsolateDDL(true))
	if err != nil {
		return err
	}
	_, err = p.Up(ctx)
	return err
}
