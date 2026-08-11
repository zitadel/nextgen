package spanner

import (
	"context"
	"time"

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
// Spanner ReadWriteTransaction automatically retries aborted transactions, for
// as long as ctx allows. [boundRetry] supplies a default deadline so a conflict
// loop fails fast instead of spinning forever.
func (c Client) Transaction(ctx context.Context, fn func(ctx context.Context, tx service.Statementer[service.AllStatements]) error) error {
	ctx, cancel := boundRetry(ctx)
	defer cancel()

	_, err := c.client.ReadWriteTransaction(ctx, func(ctx context.Context, rwt *spanner.ReadWriteTransaction) error {
		tx := newTransaction(rwt)
		return fn(ctx, tx)
	})
	return wrapError(err)
}

// maxRetryDuration bounds how long a read-write transaction may keep retrying
// aborts. ReadWriteTransaction retries ABORTED until ctx expires, so on a hot
// row an unbounded transaction spins indefinitely and piles up goroutines
// rather than surfacing a clear failure.
//
// One constant, not configuration. Turn it into a dialect option only
// once a caller genuinely needs a different bound.
const maxRetryDuration = 30 * time.Second

// boundRetry applies maxRetryDuration when ctx carries no deadline of its own.
// A caller that needs longer (or shorter) sets its own deadline and keeps it.
// The returned cancel is always non-nil and safe to defer.
func boundRetry(ctx context.Context) (context.Context, context.CancelFunc) {
	if _, ok := ctx.Deadline(); ok {
		return ctx, func() {}
	}
	return context.WithTimeout(ctx, maxRetryDuration)
}

func (c Client) Statements() service.AllStatements {
	return newStatements(newClientDB(c.client))
}

var (
	_ database.Pool = (*Client)(nil)
	_ service.Pool  = (*Client)(nil)
)
