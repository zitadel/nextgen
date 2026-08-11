package spanner

import (
	"context"

	"cloud.google.com/go/spanner"
)

// withTransaction joins an existing RW txn, or opens one on the pool client.
// Spanner forbids nested ReadWriteTransaction — if db is already txn-scoped, run fn as-is.
func withTransaction(ctx context.Context, db queryExecutor, fn func(ctx context.Context, tx queryExecutor) error) error {
	switch c := db.(type) {
	case tx:
		return fn(ctx, c)
	case client:
		ctx, cancel := boundRetry(ctx)
		defer cancel()

		_, err := c.client.ReadWriteTransaction(ctx, func(ctx context.Context, rwt *spanner.ReadWriteTransaction) error {
			return fn(ctx, newTxnDB(rwt))
		})
		return returnQueryError(err)
	default:
		return fn(ctx, db)
	}
}
