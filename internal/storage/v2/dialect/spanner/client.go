package spanner

import (
	"context"

	"cloud.google.com/go/spanner"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

type Client struct {
	client *spanner.Client
	statements
}

func newClient(client *spanner.Client) *Client {
	return &Client{
		client:     client,
		statements: newStatements(client),
	}
}

// Close implements [database.Pool].
func (c Client) Close(ctx context.Context) error {
	c.client.Close()
	return nil
}

// Ping implements [database.Pool].
func (c Client) Ping(ctx context.Context) error {
	// Spanner does not have a built-in ping method, so we execute a simple query to check the connection.
	iter := c.client.Single().Query(ctx, spanner.NewStatement("SELECT 1"))
	defer iter.Stop()
	return iter.Do(func(row *spanner.Row) error {
		return nil
	})
}

// Transaction implements [database.Pool].
func (c Client) Transaction(ctx context.Context, fn func(ctx context.Context, tx database.Transaction) error) error {
	_, err := c.client.ReadWriteTransaction(ctx, func(ctx context.Context, rwt *spanner.ReadWriteTransaction) error {
		return fn(ctx, newTransaction(rwt))
	})
	return err
}

var (
	_ database.Pool = (*Client)(nil)
)
