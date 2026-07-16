package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

type Pool struct {
	pool *pgxpool.Pool
	statements
}

func newPool(pool *pgxpool.Pool) *Pool {
	return &Pool{
		pool:       pool,
		statements: newStatements(pool),
	}
}

// Transaction implements [database.Pool].
func (p *Pool) Transaction(ctx context.Context, fn func(ctx context.Context, tx service.Statementer[service.AllStatements]) error) error {
	return executeTransaction(ctx, p.pool, fn)
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

func (p *Pool) Statements() service.AllStatements {
	return newStatements(p.pool)
}

var (
	_ database.Pool         = (*Pool)(nil)
	_ service.AllStatements = (*Pool)(nil)
	_ service.AllStatements = (*transaction)(nil)
)
