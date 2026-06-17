package postgres

import (
	"context"
	"errors"

	storagedb "github.com/zitadel/nextgen/internal/storage/database"
	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
)

type beginner interface {
	Begin(ctx context.Context, opts *storagedb.TransactionOptions) (storagedb.Transaction, error)
}

func executeTransaction(ctx context.Context, begin beginner, fn func(ctx context.Context, tx v2database.Statementer) error) error {
	tx, err := begin.Begin(ctx, nil)
	if err != nil {
		return err
	}
	wrapped := WrapTx(tx)
	defer func() {
		if err != nil {
			err = errors.Join(err, wrapped.Rollback(ctx))
			return
		}
		err = wrapped.Commit(ctx)
	}()
	return fn(ctx, wrapped)
}
