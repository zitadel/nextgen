package postgres

import (
	"context"
	"database/sql"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/zitadel/nextgen/internal/storage/database"
	migrationpkg "github.com/zitadel/nextgen/internal/storage/v2/dialect/postgres/migration"
)

type Pool struct {
	*pgxpool.Pool
}

type PostgresPooler interface {
	isPostgres()
}

// RawDB implements [database.PoolTest].
func (p *Pool) RawDB() *sql.DB {
	return stdlib.OpenDBFromPool(p.Pool)
}

var _ database.Pool = (*Pool)(nil)
var _ database.PoolTest = (*Pool)(nil)
var _ PostgresPooler = (*Pool)(nil)

func (p *Pool) isPostgres() {}

func PGxPool(pool *pgxpool.Pool) *Pool {
	return &Pool{
		Pool: pool,
	}
}

// Acquire implements [database.Pool].
func (p *Pool) Acquire(ctx context.Context) (database.Connection, error) {
	conn, err := p.Pool.Acquire(ctx)
	if err != nil {
		return nil, wrapError(err)
	}
	return &pgxConn{Conn: conn, pool: p}, nil
}

// Query implements [database.Pool].
func (p *Pool) Query(ctx context.Context, sql string, args ...any) (database.Rows, error) {
	rows, err := p.Pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, wrapError(err)
	}
	return newRows(rows), nil
}

// QueryRow implements [database.Pool].
func (p *Pool) QueryRow(ctx context.Context, sql string, args ...any) database.Row {
	return newRow(p.Pool.QueryRow(ctx, sql, args...))
}

// Exec implements [database.Pool].
func (p *Pool) Exec(ctx context.Context, sql string, args ...any) (int64, error) {
	res, err := p.Pool.Exec(ctx, sql, args...)
	if err != nil {
		return 0, wrapError(err)
	}
	return res.RowsAffected(), nil
}

// Begin implements [database.Pool].
func (p *Pool) Begin(ctx context.Context, opts *database.TransactionOptions) (database.Transaction, error) {
	tx, err := p.BeginTx(ctx, transactionOptionsToPgx(opts))
	if err != nil {
		return nil, wrapError(err)
	}
	return PGxTx(tx), nil
}

// Close implements [database.Pool].
func (p *Pool) Close(_ context.Context) error {
	p.Pool.Close()
	return nil
}

// Ping implements [database.Pool].
func (p *Pool) Ping(ctx context.Context) error {
	return wrapError(p.Pool.Ping(ctx))
}

// Migrate implements [database.Migrator].
func (p *Pool) Migrate(ctx context.Context) error {
	if isMigrated {
		return nil
	}
	db := stdlib.OpenDBFromPool(p.Pool)
	defer db.Close()
	err := migrationpkg.Migrate(ctx, db)
	isMigrated = err == nil
	return wrapError(err)
}

// MigrateTest implements [database.PoolTest].
func (p *Pool) MigrateTest(ctx context.Context) error {
	db := stdlib.OpenDBFromPool(p.Pool)
	defer db.Close()
	err := migrationpkg.Migrate(ctx, db)
	isMigrated = err == nil
	return err
}
