package main

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"io/fs"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

//go:embed migrations/*.sql
var migrationFiles embed.FS

// schema is this service's schema in the home's database.
const schema = "cloud"

// migrationLock serializes the migrations across processes: "cloud" in hex.
const migrationLock = int64(0x636c6f7564)

// migrate creates the schema and applies the pending migrations, under an
// advisory lock so two cold starts do not race the DDL.
func migrate(ctx context.Context, dsn string) (err error) {
	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		return err
	}
	delete(cfg.RuntimeParams, "schema")
	db := stdlib.OpenDB(*cfg)
	defer func() { err = errors.Join(err, db.Close()) }()

	conn, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, conn.Close()) }()
	if _, err := conn.ExecContext(ctx, "SELECT pg_advisory_lock($1)", migrationLock); err != nil {
		return fmt.Errorf("acquire migration lock: %w", err)
	}
	defer func() {
		_, unlockErr := conn.ExecContext(context.WithoutCancel(ctx), "SELECT pg_advisory_unlock($1)", migrationLock)
		err = errors.Join(err, unlockErr)
	}()
	if _, err := conn.ExecContext(ctx, "CREATE SCHEMA IF NOT EXISTS "+schema); err != nil {
		return err
	}

	files, err := fs.Sub(migrationFiles, "migrations")
	if err != nil {
		return err
	}
	provider, err := goose.NewProvider(goose.DialectPostgres, db, files, goose.WithTableName(schema+".goose_db_version"))
	if err != nil {
		return err
	}
	_, err = provider.Up(ctx)
	return err
}
