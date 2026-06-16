package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

type Connection struct {
	conn *pgxpool.Conn
}

// Transaction implements [database.Connection].
func (c *Connection) Transaction(ctx context.Context, fn func(ctx context.Context, tx database.QueryExecutor) error) error {
	return executeTransaction(ctx, c.conn, fn)
}

// Exec implements [database.Connection].
func (c *Connection) Exec(ctx context.Context, stmt string, args ...any) (int64, error) {
	panic("unimplemented")
}

// Ping implements [database.Connection].
func (c *Connection) Ping(ctx context.Context) error {
	return c.conn.Ping(ctx)
}

// Query implements [database.Connection].
func (c *Connection) Query(ctx context.Context, stmt string, args ...any) (database.Rows, error) {
	panic("unimplemented")
}

// QueryRow implements [database.Connection].
func (c *Connection) QueryRow(ctx context.Context, stmt string, args ...any) database.Row {
	panic("unimplemented")
}

// Release implements [database.Connection].
func (c *Connection) Release(ctx context.Context) error {
	c.conn.Release()
	return nil
}

var _ database.Connection = (*Connection)(nil)
