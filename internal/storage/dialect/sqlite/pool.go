package sqlite

import (
	"context"
	"database/sql"

	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/sqlite/migration"
)

// Pool wraps a *sql.DB and implements [database.Pool] and [service.Pool].
type Pool struct {
	sqlDB      *sql.DB
	isMigrated bool
	statements
}

func newPool(sqlDB *sql.DB) *Pool {
	return &Pool{
		sqlDB:      sqlDB,
		statements: newStatements(db{sqlDB: sqlDB}),
	}
}

// Transaction implements [service.Transactioner].
func (p *Pool) Transaction(ctx context.Context, fn func(ctx context.Context, tx service.Statementer[service.AllStatements]) error) error {
	return withTransaction(ctx, db{sqlDB: p.sqlDB}, func(ctx context.Context, tx queryExecutor) error {
		return fn(ctx, newStatements(tx))
	})
}

// Close implements [database.Pool].
func (p *Pool) Close(_ context.Context) error {
	return p.sqlDB.Close()
}

// Ping implements [database.Pool].
func (p *Pool) Ping(ctx context.Context) error {
	return p.sqlDB.PingContext(ctx)
}

// Migrate implements [database.Pool].
func (p *Pool) Migrate(ctx context.Context) error {
	if p.isMigrated {
		return nil
	}
	err := migration.Migrate(ctx, p.sqlDB)
	p.isMigrated = err == nil
	return err
}

// Statements implements [service.Statementer].
func (p *Pool) Statements() service.AllStatements {
	return newStatements(db{sqlDB: p.sqlDB})
}

var (
	_ database.Pool         = (*Pool)(nil)
	_ service.AllStatements = (*Pool)(nil)
)
