package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/zitadel/nextgen/internal/service"
)

type transaction struct {
	tx pgx.Tx
	statements
}

type beginner interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

func executeTransaction(ctx context.Context, begin beginner, callback func(ctx context.Context, tx service.Statementer[service.AllStatements]) error) (err error) {
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
	return callback(ctx, transaction{tx: tx, statements: newStatements(tx)})
}
