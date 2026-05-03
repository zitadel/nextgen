package spanner

import (
	"context"
	"database/sql"

	"github.com/zitadel/nextgen/internal/storage/database"
)

type spannerConn struct {
	conn *sql.Conn
	pool *spannerPool // used for Migrate
}

var _ database.Connection = (*spannerConn)(nil)

// Release implements [database.Connection].
func (c *spannerConn) Release(_ context.Context) error {
	return wrapError(c.conn.Close())
}

// Begin implements [database.Connection].
func (c *spannerConn) Begin(ctx context.Context, opts *database.TransactionOptions) (database.Transaction, error) {
	tx, err := c.conn.BeginTx(ctx, transactionOptions(opts))
	if err != nil {
		return nil, wrapError(err)
	}
	return newTransaction(tx), nil
}

// Query implements [database.Connection].
func (c *spannerConn) Query(ctx context.Context, query string, args ...any) (database.Rows, error) {
	rows, err := c.conn.QueryContext(ctx, convertPlaceholders(query), args...)
	if err != nil {
		return nil, wrapError(err)
	}
	return newRows(rows), nil
}

// QueryRow implements [database.Connection].
func (c *spannerConn) QueryRow(ctx context.Context, query string, args ...any) database.Row {
	return newRow(c.conn.QueryRowContext(ctx, convertPlaceholders(query), args...))
}

// Exec implements [database.Connection].
func (c *spannerConn) Exec(ctx context.Context, query string, args ...any) (int64, error) {
	res, err := c.conn.ExecContext(ctx, convertPlaceholders(query), args...)
	if err != nil {
		return 0, wrapError(err)
	}
	n, err := res.RowsAffected()
	return n, wrapError(err)
}

// Ping implements [database.Connection].
func (c *spannerConn) Ping(ctx context.Context) error {
	return wrapError(c.conn.PingContext(ctx))
}

// Migrate implements [database.Migrator].
func (c *spannerConn) Migrate(ctx context.Context) error {
	return c.pool.Migrate(ctx)
}
