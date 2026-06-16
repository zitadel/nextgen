package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

type Transaction struct {
	tx pgx.Tx
}

type beginner interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

func executeTransaction(ctx context.Context, begin beginner, fn func(ctx context.Context, tx database.QueryExecutor) error) error {
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
	return fn(ctx, &Transaction{tx: tx})
}

// Exec implements [database.Transaction].
// Subtle: this method shadows the method (Tx).Exec of Transaction.Tx.
func (t *Transaction) Exec(ctx context.Context, stmt string, args ...any) (int64, error) {
	panic("unimplemented")
}

// Query implements [database.Transaction].
// Subtle: this method shadows the method (Tx).Query of Transaction.Tx.
func (t *Transaction) Query(ctx context.Context, stmt string, args ...any) (database.Rows, error) {
	panic("unimplemented")
}

// QueryRow implements [database.Transaction].
// Subtle: this method shadows the method (Tx).QueryRow of Transaction.Tx.
func (t *Transaction) QueryRow(ctx context.Context, stmt string, args ...any) database.Row {
	panic("unimplemented")
}
