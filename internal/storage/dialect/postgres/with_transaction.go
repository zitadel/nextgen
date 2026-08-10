package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// withTransaction runs fn in a transaction when client can Begin.
// *pgxpool.Pool → new tx; pgx.Tx → savepoint (joins outer service Transaction).
// If client is not a beginner, runs fn on client as-is.
func withTransaction(ctx context.Context, client queryExecutor, fn func(ctx context.Context, tx queryExecutor) error) (err error) {
	beginner, ok := client.(interface {
		Begin(ctx context.Context) (pgx.Tx, error)
	})
	if !ok {
		return fn(ctx, client)
	}
	tx, err := beginner.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback(ctx)
			panic(p)
		}
		if err != nil {
			err = errors.Join(err, tx.Rollback(ctx))
			return
		}
		err = tx.Commit(ctx)
	}()
	return fn(ctx, tx)
}
