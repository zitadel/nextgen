package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

type Connection struct {
	conn *pgxpool.Conn
	statements
}

func newConnection(conn *pgxpool.Conn) *Connection {
	return &Connection{
		conn:       conn,
		statements: statements{client: conn},
	}
}

// Transaction implements [database.Connection].
func (c Connection) Transaction(ctx context.Context, fn func(ctx context.Context, tx database.Statementer) error) error {
	return executeTransaction(ctx, c.conn, fn)
}

// Ping implements [database.Connection].
func (c Connection) Ping(ctx context.Context) error {
	return c.conn.Ping(ctx)
}

// Release implements [database.Connection].
func (c Connection) Release(ctx context.Context) error {
	c.conn.Release()
	return nil
}

var _ database.Connection = (*Connection)(nil)
