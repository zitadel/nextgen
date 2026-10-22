package spanner

import (
	"context"

	"cloud.google.com/go/spanner"
)

// withTransaction joins an existing RW txn, or opens one on the pool client.
// Spanner forbids nested ReadWriteTransaction — if db is already txn-scoped, run fn as-is.
// The switch looks through [tracedExecutor]; fn gets a traced executor.
func withTransaction(ctx context.Context, db queryExecutor, fn func(ctx context.Context, tx queryExecutor) error) error {
	switch c := untraced(db).(type) {
	case tx:
		return fn(ctx, db)
	case client:
		return returnQueryError(runBounded(ctx, func(ctx context.Context) error {
			_, err := c.client.ReadWriteTransaction(ctx, func(ctx context.Context, rwt *spanner.ReadWriteTransaction) error {
				return fn(ctx, traced(newTxnDB(rwt)))
			})
			return err
		}))
	default:
		return fn(ctx, db)
	}
}
