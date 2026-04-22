// Package migration provides a dialect-agnostic migration runner built on
// goose v3. A single call to [Up] or [Down] migrates either a PostgreSQL or
// a Google Spanner database; the caller selects the target via [Dialect].
//
// SQL migration files live under sql/postgres/ and sql/spanner/, embedded at
// compile time via embed.FS. The postgres path is always compiled in. Spanner
// support is opt-in: build with -tags spanner (see driver_spanner.go), which
// adds the go-sql-spanner database/sql driver.
//
// goose's Provider API is used rather than the global goose.SetDialect /
// goose.SetBaseFS functions, so multiple concurrent Migrate calls are safe.
package migration

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"

	"github.com/pressly/goose/v3"
)

//go:embed sql/postgres
var postgresSQL embed.FS

//go:embed sql/spanner
var spannerSQL embed.FS

// Dialect identifies the target database engine.
type Dialect string

const (
	Postgres Dialect = "postgres"
	Spanner  Dialect = "spanner"
)

// Up applies all pending migrations against db.
// db must be opened with a driver that matches dialect
// (e.g. lib/pq or pgx/stdlib for Postgres, go-sql-spanner for Spanner).
func Up(ctx context.Context, db *sql.DB, dialect Dialect) error {
	p, err := newProvider(db, dialect)
	if err != nil {
		return err
	}
	defer p.Close()
	_, err = p.Up(ctx)
	return err
}

// Down rolls back the most recent applied migration.
func Down(ctx context.Context, db *sql.DB, dialect Dialect) error {
	p, err := newProvider(db, dialect)
	if err != nil {
		return err
	}
	defer p.Close()
	_, err = p.Down(ctx)
	return err
}

// Migrator holds a db handle and dialect, and implements database.Migrator.
// Construct one and embed it in a dialect-specific Pool implementation to
// wire goose migrations into the existing Pool.Migrate contract.
type Migrator struct {
	DB      *sql.DB
	Dialect Dialect
}

// Migrate implements database.Migrator.
func (m *Migrator) Migrate(ctx context.Context) error {
	return Up(ctx, m.DB, m.Dialect)
}

func newProvider(db *sql.DB, dialect Dialect) (*goose.Provider, error) {
	fsys, dir, gooseDialect, err := dialectConfig(dialect)
	if err != nil {
		return nil, err
	}
	sub, err := fs.Sub(fsys, dir)
	if err != nil {
		return nil, fmt.Errorf("migration fs: %w", err)
	}
	return goose.NewProvider(gooseDialect, db, sub)
}

func dialectConfig(d Dialect) (embed.FS, string, goose.Dialect, error) {
	switch d {
	case Postgres:
		return postgresSQL, "sql/postgres", goose.DialectPostgres, nil
	case Spanner:
		return spannerSQL, "sql/spanner", goose.DialectSpanner, nil
	default:
		return embed.FS{}, "", "", fmt.Errorf("unsupported dialect: %q", d)
	}
}
