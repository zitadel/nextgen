package spanner

import (
	"context"
	"errors"
	"time"

	"cloud.google.com/go/spanner"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
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
// as long as ctx allows. [runBounded] supplies a default deadline so a conflict
// loop fails fast instead of spinning forever.
func (c Client) Transaction(ctx context.Context, fn func(ctx context.Context, tx service.Statementer[service.AllStatements]) error) error {
	return wrapError(runBounded(ctx, func(ctx context.Context) error {
		_, err := c.client.ReadWriteTransaction(ctx, func(ctx context.Context, rwt *spanner.ReadWriteTransaction) error {
			tx := newTransaction(rwt)
			return fn(ctx, tx)
		})
		return err
	}))
}

// maxRetryDuration bounds how long a read-write transaction may keep retrying
// aborts. ReadWriteTransaction retries ABORTED until ctx expires, so on a hot
// row an unbounded transaction spins indefinitely and piles up goroutines
// rather than surfacing a clear failure.
//
// One constant, not configuration. The integration tests run under it too: on
// Spanner Omni their aborts come from row conflicts and the abort injector
// (client_options_integration.go), neither of which starves a transaction the
// way the emulator's process-wide lock can. Turn it into a dialect option only
// once a caller genuinely needs a different bound.
const maxRetryDuration = 30 * time.Second

// boundRetry applies [maxRetryDuration] when ctx carries no deadline of its own.
// A caller that needs longer (or shorter) sets its own deadline and keeps it.
// The returned cancel is always non-nil and safe to defer.
func boundRetry(ctx context.Context) (context.Context, context.CancelFunc) {
	if _, ok := ctx.Deadline(); ok {
		return ctx, func() {}
	}
	return context.WithTimeout(ctx, maxRetryDuration)
}

// runBounded runs fn under the retry budget and reports when a deadline is what
// ended it. Every site in this package that opens a ReadWriteTransaction goes
// through here, so exhaustion is logged once and in one place: without it the
// only trace a spent budget leaves is a request's wall-clock duration.
//
// Only a deadline is worth a warning. A cancelled context means the caller went
// away, which is ordinary traffic and would drown this line in noise. The
// deadline may be the budget or one the caller set; `elapsed` tells them apart
// and both mean the same thing operationally, a transaction that never landed.
func runBounded(ctx context.Context, fn func(context.Context) error) error {
	ctx, cancel := boundRetry(ctx)
	defer cancel()

	start := time.Now()
	err := fn(ctx)
	if err != nil && errors.Is(ctx.Err(), context.DeadlineExceeded) {
		zlog.Warn(ctx, "spanner transaction hit its deadline while retrying",
			"elapsed", time.Since(start), "error", err)
	}
	return err
}

func (c Client) Statements() service.AllStatements {
	return newStatements(newClientDB(c.client))
}

var (
	_ database.Pool = (*Client)(nil)
	_ service.Pool  = (*Client)(nil)
)
