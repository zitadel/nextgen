package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

type transaction struct {
	tx pgx.Tx
	statements
}

type beginner interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

func executeTransaction(ctx context.Context, begin beginner, fn func(ctx context.Context, tx database.Statementer) error) error {
	tx, err := begin.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, tx.Rollback(ctx))
			return
		}
		err = tx.Commit(ctx)
	}()
	return fn(ctx, &transaction{tx: tx, statements: statements{client: tx}})
}

var _ database.Statementer = (*transaction)(nil)
