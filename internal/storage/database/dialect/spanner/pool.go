package spanner

import (
	"context"
	"database/sql"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/spanner/migration"
)

type pgxPool struct {
	*pgxpool.Pool
}

var _ database.Pool = (*pgxPool)(nil)
var _ database.PoolTest = (*pgxPool)(nil)

func (p *pgxPool) RawDB() *sql.DB {
	return stdlib.OpenDBFromPool(p.Pool)
}

func (p *pgxPool) Acquire(ctx context.Context) (database.Connection, error) {
	conn, err := p.Pool.Acquire(ctx)
	if err != nil {
		return nil, wrapError(err)
	}
	return &pgxConn{Conn: conn}, nil
}

func (p *pgxPool) Query(ctx context.Context, sql string, args ...any) (database.Rows, error) {
	rows, err := p.Pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, wrapError(err)
	}
	return newRows(rows), nil
}

func (p *pgxPool) QueryRow(ctx context.Context, sql string, args ...any) database.Row {
	return newRow(p.Pool.QueryRow(ctx, sql, args...))
}

func (p *pgxPool) Exec(ctx context.Context, sql string, args ...any) (int64, error) {
	res, err := p.Pool.Exec(ctx, sql, args...)
	if err != nil {
		return 0, wrapError(err)
	}
	return res.RowsAffected(), nil
}

func (p *pgxPool) Begin(ctx context.Context, opts *database.TransactionOptions) (database.Transaction, error) {
	tx, err := p.BeginTx(ctx, transactionOptionsToPgx(opts))
	if err != nil {
		return nil, wrapError(err)
	}
	return newTransaction(tx), nil
}

func (p *pgxPool) Close(_ context.Context) error {
	p.Pool.Close()
	return nil
}

func (p *pgxPool) Ping(ctx context.Context) error {
	return wrapError(p.Pool.Ping(ctx))
}

func (p *pgxPool) Migrate(ctx context.Context) error {
	if isMigrated {
		return nil
	}
	client, err := p.Pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer client.Release()
	err = migration.Migrate(ctx, client.Conn())
	isMigrated = err == nil
	return wrapError(err)
}

func (p *pgxPool) MigrateTest(ctx context.Context) error {
	client, err := p.Pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer client.Release()
	err = migration.Migrate(ctx, client.Conn())
	isMigrated = err == nil
	return err
}
