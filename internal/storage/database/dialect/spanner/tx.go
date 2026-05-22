package spanner

import (
	"context"
	"database/sql"
	"errors"

	"github.com/zitadel/nextgen/internal/storage/database"
)

type Transaction struct {
	tx *sql.Tx
}

var _ database.Transaction = (*Transaction)(nil)
var _ SpannerPooler = (*Transaction)(nil)

func (t *Transaction) isSpanner() {}

func newTransaction(tx *sql.Tx) *Transaction {
	return &Transaction{tx: tx}
}

func (t *Transaction) Commit(_ context.Context) error {
	return wrapError(t.tx.Commit())
}

func (t *Transaction) Rollback(_ context.Context) error {
	return wrapError(t.tx.Rollback())
}

func (t *Transaction) End(ctx context.Context, err error) error {
	if err != nil {
		rollbackErr := t.Rollback(ctx)
		if rollbackErr != nil {
			err = errors.Join(err, rollbackErr)
		}
		return err
	}
	return t.Commit(ctx)
}

// Begin returns an error: Spanner does not support nested transactions or savepoints.
func (t *Transaction) Begin(_ context.Context, _ *database.TransactionOptions) (database.Transaction, error) {
	return nil, database.NewUnknownError(errors.New("nested transactions not supported in Spanner"))
}

func (t *Transaction) Query(ctx context.Context, query string, args ...any) (database.Rows, error) {
	rows, err := t.tx.QueryContext(ctx, convertPlaceholders(query), args...)
	if err != nil {
		return nil, wrapError(err)
	}
	return newRows(rows), nil
}

func (t *Transaction) QueryRow(ctx context.Context, query string, args ...any) database.Row {
	return newRow(t.tx.QueryRowContext(ctx, convertPlaceholders(query), args...))
}

func (t *Transaction) Exec(ctx context.Context, query string, args ...any) (int64, error) {
	res, err := t.tx.ExecContext(ctx, convertPlaceholders(query), args...)
	if err != nil {
		return 0, wrapError(err)
	}
	n, err := res.RowsAffected()
	return n, wrapError(err)
}

func transactionOptions(opts *database.TransactionOptions) *sql.TxOptions {
	if opts == nil {
		return nil
	}
	var iso sql.IsolationLevel
	switch opts.IsolationLevel {
	case database.IsolationLevelSerializable:
		iso = sql.LevelSerializable
	case database.IsolationLevelReadCommitted:
		iso = sql.LevelReadCommitted
	default:
		iso = sql.LevelSerializable
	}
	readOnly := opts.AccessMode == database.AccessModeReadOnly
	return &sql.TxOptions{Isolation: iso, ReadOnly: readOnly}
}
