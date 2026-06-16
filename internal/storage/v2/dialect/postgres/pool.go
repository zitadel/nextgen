package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

type Pool struct {
	pool *pgxpool.Pool
}

// Acquire implements [database.Pool].
func (p *Pool) Acquire(ctx context.Context) (database.Connection, error) {
	conn, err := p.pool.Acquire(ctx)
	if err != nil {
		return nil, err
	}
	return &Connection{conn: conn}, nil
}

// Transaction implements [database.Pool].
func (p *Pool) Transaction(ctx context.Context, fn func(ctx context.Context, tx database.QueryExecutor) error) error {
	return executeTransaction(ctx, p.pool, fn)
}

// Close implements [database.Pool].
func (p *Pool) Close(ctx context.Context) error {
	p.pool.Close()
	return nil
}

// Exec implements [database.Pool].
func (p *Pool) Exec(ctx context.Context, stmt string, args ...any) (int64, error) {
	panic("unimplemented")
}

// Ping implements [database.Pool].
func (p *Pool) Ping(ctx context.Context) error {
	return p.pool.Ping(ctx)
}

// Query implements [database.Pool].
func (p *Pool) Query(ctx context.Context, stmt string, args ...any) (database.Rows, error) {
	panic("unimplemented")
}

// QueryRow implements [database.Pool].
func (p *Pool) QueryRow(ctx context.Context, stmt string, args ...any) database.Row {
	panic("unimplemented")
}

var _ database.Pool = (*Pool)(nil)
