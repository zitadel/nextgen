package spanner

import (
	"context"

	"cloud.google.com/go/spanner"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type Client struct {
	client     *spanner.Client
	dsn        string
	isMigrated bool
	statements
}

func newClient(dsn string, spannerClient *spanner.Client) *Client {
	return &Client{
		client:     spannerClient,
		dsn:        dsn,
		statements: newStatements(newClientDB(spannerClient)),
	}
}

// Close implements [database.Pool].
func (c *Client) Close(ctx context.Context) error {
	c.client.Close()
	return nil
}

// Ping implements [database.Pool].
func (c Client) Ping(ctx context.Context) error {
	tx := c.client.Single()
	defer tx.Close()
	iter := tx.Query(ctx, spanner.Statement{SQL: "SELECT 1"})
	defer iter.Stop()
	return wrapError(iter.Do(func(*spanner.Row) error { return nil }))
}

// Transaction implements [service.Transactioner].
//
// Spanner ReadWriteTransaction automatically retries aborted transactions.
// Callers should set a deadline on ctx to bound total retry time; without a
// deadline a conflict loop can run indefinitely.
func (c Client) Transaction(ctx context.Context, fn func(ctx context.Context, tx service.Statementer[service.AllStatements]) error) error {
	_, err := c.client.ReadWriteTransaction(ctx, func(ctx context.Context, rwt *spanner.ReadWriteTransaction) error {
		tx := newTransaction(rwt)
		return fn(ctx, tx)
	})
	return wrapError(err)
}

func (c Client) Statements() service.AllStatements {
	return newStatements(newClientDB(c.client))
}

var (
	_ database.Pool = (*Client)(nil)
	_ service.Pool  = (*Client)(nil)
)
