package sqlite

import (
	"context"
	"database/sql"
	"errors"

	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/sqlite/migration"
)

// Pool wraps a *sql.DB and implements [database.Pool] and [service.Pool].
type Pool struct {
	sqlDB      *sql.DB
	isMigrated bool
	// stopMetrics stops reporting the pool's connections.
	stopMetrics func() error
	statements
}

func newPool(sqlDB *sql.DB) *Pool {
	stopMetrics := metrics.RegisterPool(metrics.PoolSQLite, func() metrics.PoolStats {
		stats := sqlDB.Stats()
		return metrics.PoolStats{
			Used: stats.InUse,
			Idle: stats.Idle,
			Max:  stats.MaxOpenConnections,
		}
	})
	return &Pool{
		sqlDB:       sqlDB,
		stopMetrics: stopMetrics,
		statements:  newStatements(db{sqlDB: sqlDB}),
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
	// Stop reporting first, so a collection during Close does not read a
	// closed pool.
	return errors.Join(p.stopMetrics(), p.sqlDB.Close())
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
