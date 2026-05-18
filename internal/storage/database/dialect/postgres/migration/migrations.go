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

const schemaName = "zitadel_nextgen"

// Migrate applies all pending migrations to db. It is idempotent: already-applied
// migrations are skipped. The zitadel_nextgen schema is created if it does not exist,
// since the goose tracking table lives there.
func Migrate(ctx context.Context, db *sql.DB) error {
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
	_, err = p.Up(ctx)
	return err
}
