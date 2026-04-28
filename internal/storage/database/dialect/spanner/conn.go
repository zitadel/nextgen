package spanner

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/spanner/migration"
)

type pgxConn struct {
	*pgxpool.Conn
}

var _ database.Connection = (*pgxConn)(nil)

func (c *pgxConn) Release(_ context.Context) error {
	c.Conn.Release()
	return nil
}

func (c *pgxConn) Begin(ctx context.Context, opts *database.TransactionOptions) (database.Transaction, error) {
	tx, err := c.BeginTx(ctx, transactionOptionsToPgx(opts))
	if err != nil {
		return nil, wrapError(err)
	}
	return newTransaction(tx), nil
}

func (c *pgxConn) Query(ctx context.Context, sql string, args ...any) (database.Rows, error) {
	rows, err := c.Conn.Query(ctx, sql, args...)
	if err != nil {
		return nil, wrapError(err)
	}
	return newRows(rows), nil
}

func (c *pgxConn) QueryRow(ctx context.Context, sql string, args ...any) database.Row {
	return newRow(c.Conn.QueryRow(ctx, sql, args...))
}

func (c *pgxConn) Exec(ctx context.Context, sql string, args ...any) (int64, error) {
	res, err := c.Conn.Exec(ctx, sql, args...)
	if err != nil {
		return 0, wrapError(err)
	}
	return res.RowsAffected(), nil
}

func (c *pgxConn) Ping(ctx context.Context) error {
	return wrapError(c.Conn.Ping(ctx))
}

func (c *pgxConn) Migrate(ctx context.Context) error {
	if isMigrated {
		return nil
	}
	err := migration.Migrate(ctx, c.Conn.Conn())
	isMigrated = err == nil
	return wrapError(err)
}
