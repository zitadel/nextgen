package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/postgres/migration"
	pgschema "github.com/zitadel/nextgen/internal/storage/dialect/postgres/schema"
)

type Pool struct {
	pool       *pgxpool.Pool
	schema     string
	isMigrated bool
	statements
}

// newPool wraps pool for schema; an empty schema means [pgschema.Default].
func newPool(pool *pgxpool.Pool, schema string) *Pool {
	if schema == "" {
		schema = pgschema.Default
	}
	return &Pool{
		pool:       pool,
		schema:     schema,
		statements: newStatements(clientFor(pool, schema)),
	}
}

// Schema returns the schema this pool reads and writes.
func (p *Pool) Schema() string {
	return p.schema
}

// Transaction implements [database.Pool].
func (p *Pool) Transaction(ctx context.Context, fn func(ctx context.Context, tx service.Statementer[service.AllStatements]) error) error {
	return executeTransaction(ctx, clientFor(p.pool, p.schema), fn)
}

// Close implements [database.Pool].
func (p *Pool) Close(ctx context.Context) error {
	p.pool.Close()
	return nil
}

// Ping implements [database.Pool].
func (p *Pool) Ping(ctx context.Context) error {
	return p.pool.Ping(ctx)
}

// Migrate implements [database.Pool].
func (p *Pool) Migrate(ctx context.Context) error {
	if p.isMigrated {
		return nil
	}
	db := stdlib.OpenDBFromPool(p.pool)
	defer db.Close()
	err := migration.MigrateInto(ctx, db, p.schema)
	p.isMigrated = err == nil
	return wrapError(err)
}

func (p *Pool) Statements() service.AllStatements {
	return newStatements(clientFor(p.pool, p.schema))
}

var (
	_ database.Pool         = (*Pool)(nil)
	_ service.Pool          = (*Pool)(nil)
	_ service.AllStatements = (*Pool)(nil)
	_ service.AllStatements = (*transaction)(nil)
)
