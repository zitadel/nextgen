package sqlite

import (
	"context"
	"database/sql"
	"errors"
)

// withTransaction runs fn in a transaction.
// If client is a db (wraps *sql.DB), a new transaction is started.
// If client is already a txExecutor, fn runs on it directly (joins the outer tx).
// Any other queryExecutor type also runs fn directly.
func withTransaction(ctx context.Context, client queryExecutor, fn func(ctx context.Context, tx queryExecutor) error) (err error) {
	type beginner interface {
		BeginTx(ctx context.Context, opts *sql.TxOptions) (*sql.Tx, error)
	}
	b, ok := client.(beginner)
	if !ok {
		return fn(ctx, client)
	}
	sqlTx, err := b.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		if p := recover(); p != nil {
			_ = sqlTx.Rollback()
			panic(p)
		}
		if err != nil {
			err = errors.Join(err, sqlTx.Rollback())
			return
		}
		err = sqlTx.Commit()
	}()
	return fn(ctx, txExecutor{sqlTx: sqlTx})
}
