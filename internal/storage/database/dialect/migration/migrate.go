// Package migration provides a dialect-agnostic migration runner built on
// golang-migrate. A single call to [Up] or [Down] migrates either a
// PostgreSQL or a Google Spanner database; the caller selects the target via
// [Dialect].
//
// SQL migration files live in the subdirectories sql/postgres/ and
// sql/spanner/, embedded at compile time. The postgres path is always
// compiled in. Spanner support is opt-in: build with -tags spanner to
// include the Spanner driver (see driver_spanner.go).
package migration

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"strings"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
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

// Up applies all pending migrations.
//
// DSN formats:
//   - Postgres: "postgres://user:pass@host:port/db?sslmode=disable"
//   - Spanner:  "spanner://projects/P/instances/I/databases/D"
//     (x-clean-statements=true is appended automatically — required by the
//     Spanner driver to handle multi-statement DDL files.)
func Up(ctx context.Context, dsn string, dialect Dialect) error {
	m, err := newMigrator(dsn, dialect)
	if err != nil {
		return err
	}
	defer m.Close()

	// Propagate context cancellation to the migrator via GracefulStop.
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	go func() {
		<-ctx.Done()
		m.GracefulStop <- true
	}()

	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("migrate up: %w", err)
	}
	return nil
}

// Down rolls back the most recent n migrations.
func Down(ctx context.Context, dsn string, dialect Dialect, steps int) error {
	m, err := newMigrator(dsn, dialect)
	if err != nil {
		return err
	}
	defer m.Close()

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	go func() {
		<-ctx.Done()
		m.GracefulStop <- true
	}()

	if err := m.Steps(-steps); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("migrate down %d: %w", steps, err)
	}
	return nil
}

// Migrator wraps a DSN + Dialect pair and implements [database.Migrator].
// Embed it in a dialect-specific Config to wire migrations into the Pool.
type Migrator struct {
	DSN     string
	Dialect Dialect
}

// Migrate implements database.Migrator.
func (mg *Migrator) Migrate(ctx context.Context) error {
	return Up(ctx, mg.DSN, mg.Dialect)
}

// newMigrator builds a *migrate.Migrate for the given dialect.
func newMigrator(dsn string, dialect Dialect) (*migrate.Migrate, error) {
	fsys, dir, err := dialectFS(dialect)
	if err != nil {
		return nil, err
	}
	if dialect == Spanner {
		dsn = appendQueryParam(dsn, "x-clean-statements=true")
	}

	src, err := iofs.New(fsys, dir)
	if err != nil {
		return nil, fmt.Errorf("migration source: %w", err)
	}

	m, err := migrate.NewWithSourceInstance("iofs", src, dsn)
	if err != nil {
		return nil, fmt.Errorf("init migrator: %w", err)
	}
	return m, nil
}

func dialectFS(d Dialect) (embed.FS, string, error) {
	switch d {
	case Postgres:
		return postgresSQL, "sql/postgres", nil
	case Spanner:
		return spannerSQL, "sql/spanner", nil
	default:
		return embed.FS{}, "", fmt.Errorf("unsupported dialect: %q", d)
	}
}

func appendQueryParam(dsn, param string) string {
	if strings.Contains(dsn, "?") {
		return dsn + "&" + param
	}
	return dsn + "?" + param
}
