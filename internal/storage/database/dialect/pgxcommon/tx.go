package pgxcommon

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/storage/database"
)

var _ database.Transaction = (*Transaction)(nil)

// Transaction wraps pgx.Tx and applies a dialect-specific error mapper.
type Transaction struct {
	tx      pgx.Tx
	wrapErr func(error) error
}

// NewTransaction wraps tx, applying wrapErr to all errors.
func NewTransaction(tx pgx.Tx, wrapErr func(error) error) *Transaction {
	return &Transaction{tx: tx, wrapErr: wrapErr}
}

func (tx *Transaction) Commit(ctx context.Context) error {
	return tx.wrapErr(tx.tx.Commit(ctx))
}

func (tx *Transaction) Rollback(ctx context.Context) error {
	return tx.wrapErr(tx.tx.Rollback(ctx))
}

func (tx *Transaction) End(ctx context.Context, err error) error {
	if err != nil {
		rollbackErr := tx.Rollback(ctx)
		if rollbackErr != nil {
			err = errors.Join(err, rollbackErr)
		}
		return err
	}
	return tx.Commit(ctx)
}

func (tx *Transaction) Query(ctx context.Context, sql string, args ...any) (database.Rows, error) {
	rows, err := tx.tx.Query(ctx, sql, args...)
	if err != nil {
		return nil, tx.wrapErr(err)
	}
	return NewRows(rows, tx.wrapErr), nil
}

func (tx *Transaction) QueryRow(ctx context.Context, sql string, args ...any) database.Row {
	return NewRow(tx.tx.QueryRow(ctx, sql, args...), tx.wrapErr)
}

func (tx *Transaction) Exec(ctx context.Context, sql string, args ...any) (int64, error) {
	res, err := tx.tx.Exec(ctx, sql, args...)
	if err != nil {
		return 0, tx.wrapErr(err)
	}
	return res.RowsAffected(), nil
}

// Begin creates a savepoint to emulate nested transactions.
// opts is ignored because pgx savepoints do not accept per-nested-tx options.
func (tx *Transaction) Begin(ctx context.Context, _ *database.TransactionOptions) (database.Transaction, error) {
	savepoint, err := tx.tx.Begin(ctx)
	if err != nil {
		return nil, tx.wrapErr(err)
	}
	return NewTransaction(savepoint, tx.wrapErr), nil
}

// TransactionOptionsToPgx converts [database.TransactionOptions] to pgx options.
func TransactionOptionsToPgx(opts *database.TransactionOptions) pgx.TxOptions {
	if opts == nil {
		return pgx.TxOptions{}
	}
	return pgx.TxOptions{
		IsoLevel:   IsolationToPgx(opts.IsolationLevel),
		AccessMode: AccessModeToPgx(opts.AccessMode),
	}
}

// IsolationToPgx converts a [database.IsolationLevel] to its pgx equivalent.
func IsolationToPgx(isolation database.IsolationLevel) pgx.TxIsoLevel {
	switch isolation {
	case database.IsolationLevelSerializable:
		return pgx.Serializable
	case database.IsolationLevelReadCommitted:
		return pgx.ReadCommitted
	default:
		return pgx.Serializable
	}
}

// AccessModeToPgx converts a [database.AccessMode] to its pgx equivalent.
func AccessModeToPgx(accessMode database.AccessMode) pgx.TxAccessMode {
	switch accessMode {
	case database.AccessModeReadWrite:
		return pgx.ReadWrite
	case database.AccessModeReadOnly:
		return pgx.ReadOnly
	default:
		return pgx.ReadWrite
	}
}
