package spanner

import (
	"context"

	"cloud.google.com/go/spanner"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

type Client struct {
	client *spanner.Client
}

// Release implements [database.Connection].
func (c *Client) Release(ctx context.Context) error {
	return nil
}

// Acquire implements [database.Pool].
func (c *Client) Acquire(ctx context.Context) (database.Connection, error) {
	return c, nil
}

// Close implements [database.Pool].
func (c *Client) Close(ctx context.Context) error {
	c.client.Close()
	return nil
}

// Exec implements [database.Pool].
func (c *Client) Exec(ctx context.Context, stmt string, args ...any) (int64, error) {
	panic("unimplemented")
}

// Ping implements [database.Pool].
//
// Spanner does not have a built-in ping method, so we execute a simple query to check the connection.
func (c *Client) Ping(ctx context.Context) error {
	_, err := c.Query(ctx, "SELECT 1")
	return err
}

// Query implements [database.Pool].
func (c *Client) Query(ctx context.Context, stmt string, args ...any) (database.Rows, error) {
	panic("unimplemented")
}

// QueryRow implements [database.Pool].
func (c *Client) QueryRow(ctx context.Context, stmt string, args ...any) database.Row {
	panic("unimplemented")
}

// Transaction implements [database.Pool].
func (c *Client) Transaction(ctx context.Context, fn func(ctx context.Context, tx database.QueryExecutor) error) error {
	_, err := c.client.ReadWriteTransaction(ctx, func(ctx context.Context, rwt *spanner.ReadWriteTransaction) error {
		return fn(ctx, &Transaction{tx: rwt})
	})
	return err
}

var (
	_ database.Pool       = (*Client)(nil)
	_ database.Connection = (*Client)(nil)
)
