package spanner

import (
	"context"

	"cloud.google.com/go/spanner"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

type Client struct {
	client *spanner.Client
	statements
}

func newClient(spannerClient *spanner.Client) *Client {
	executor := newClientExecutor(spannerClient)
	return &Client{
		client:     spannerClient,
		statements: newStatements(executor),
	}
}

// Close implements [database.Pool].
func (c *Client) Close(ctx context.Context) error {
	c.client.Close()
	return nil
}

// Ping implements [database.Pool].
func (c Client) Ping(ctx context.Context) error {
	iter := c.client.Single().Query(ctx, spanner.Statement{SQL: "SELECT 1"})
	defer iter.Stop()
	return wrapError(iter.Do(func(*spanner.Row) error { return nil }))
}

// Transaction implements [service.Transactioner].
func (c Client) Transaction(ctx context.Context, fn func(ctx context.Context, tx service.Statementer[service.AllStatements]) error) error {
	_, err := c.client.ReadWriteTransaction(ctx, func(ctx context.Context, rwt *spanner.ReadWriteTransaction) error {
		tx := newTransaction(rwt)
		return fn(ctx, tx)
	})
	return wrapError(err)
}

func (c Client) Statements() service.AllStatements {
	return newStatements(newClientExecutor(c.client))
}

var (
	_ database.Pool = (*Client)(nil)
	_ service.Pool  = (*Client)(nil)
)
