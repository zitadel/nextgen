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
	// stopMetrics stops reporting the pool's connections.
	stopMetrics func() error
	statements
}

func newPool(pool *pgxpool.Pool) *Pool {
	stopMetrics := metrics.RegisterPool(metrics.PoolPostgres, func() metrics.PoolStats {
		stat := pool.Stat()
		return metrics.PoolStats{
			Used: int(stat.AcquiredConns()),
			Idle: int(stat.IdleConns()),
			Max:  int(stat.MaxConns()),
		}
	})
	return &Pool{
		pool:        pool,
		stopMetrics: stopMetrics,
		statements:  newStatements(pool),
	}
}

// Transaction implements [database.Pool].
func (p *Pool) Transaction(ctx context.Context, fn func(ctx context.Context, tx service.Statementer[service.AllStatements]) error) error {
	return executeTransaction(ctx, p.pool, fn)
}

// Close implements [database.Pool].
func (p *Pool) Close(ctx context.Context) error {
	// Stop reporting first, so a collection during Close does not read a
	// closed pool.
	err := p.stopMetrics()
	p.pool.Close()
	return err
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
	return newStatements(p.pool)
}

var (
	_ database.Pool         = (*Pool)(nil)
	_ service.Pool          = (*Pool)(nil)
	_ service.AllStatements = (*Pool)(nil)
	_ service.AllStatements = (*transaction)(nil)
)
