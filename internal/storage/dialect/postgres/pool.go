package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/postgres/migration"
)

type Pool struct {
	pool       *pgxpool.Pool
	isMigrated bool
	// unregisterStats stops the pool connection gauge from reading pool.
	unregisterStats func()
	statements
}

func newPool(pool *pgxpool.Pool) *Pool {
	return &Pool{
		pool: pool,
		unregisterStats: metrics.Default().RegisterPool(metrics.DialectPostgres, func() metrics.PoolStats {
			stats := pool.Stat()
			return metrics.PoolStats{InUse: int(stats.AcquiredConns()), Idle: int(stats.IdleConns())}
		}),
		statements: newStatements(meteredPool{pool}),
	}
}

// Transaction implements [database.Pool].
func (p *Pool) Transaction(ctx context.Context, fn func(ctx context.Context, tx service.Statementer[service.AllStatements]) error) error {
	return executeTransaction(ctx, meteredPool{p.pool}, fn)
}

// Close implements [database.Pool].
func (p *Pool) Close(ctx context.Context) error {
	p.unregisterStats()
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
	err := migration.Migrate(ctx, db)
	p.isMigrated = err == nil
	return wrapError(err)
}

func (p *Pool) Statements() service.AllStatements {
	return newStatements(meteredPool{p.pool})
}

var (
	_ database.Pool         = (*Pool)(nil)
	_ service.Pool          = (*Pool)(nil)
	_ service.AllStatements = (*Pool)(nil)
	_ service.AllStatements = (*transaction)(nil)
)
