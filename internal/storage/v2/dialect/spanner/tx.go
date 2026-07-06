package spanner

import (
	"context"
	"errors"

	"cloud.google.com/go/spanner"
	"google.golang.org/api/iterator"

	dbold "github.com/zitadel/nextgen/internal/storage/database"
)

type transaction struct {
	txn *spanner.ReadWriteTransaction
	statements
}

// Exec implements [database.QueryExecutor].
func (tx transaction) Exec(ctx context.Context, stmt string, args ...any) (int64, error) {
	s := buildStatementFromPostgresSQL(stmt, args).statement()
	n, err := tx.txn.Update(ctx, s)
	return n, wrapError(err)
}

// Query implements [database.QueryExecutor].
func (tx transaction) Query(ctx context.Context, stmt string, args ...any) (dbold.Rows, error) {
	s := buildStatementFromPostgresSQL(stmt, args).statement()
	iter := tx.txn.Query(ctx, s)
	return &bridgeRows{iter: iter}, nil
}

// QueryRow implements [database.QueryExecutor].
func (tx transaction) QueryRow(ctx context.Context, stmt string, args ...any) dbold.Row {
	s := buildStatementFromPostgresSQL(stmt, args).statement()
	iter := tx.txn.Query(ctx, s)
	row, err := iter.Next()
	iter.Stop()
	if errors.Is(err, iterator.Done) {
		return &bridgeRow{err: spanner.ErrRowNotFound}
	}
	if err != nil {
		return &bridgeRow{err: err}
	}
	return &bridgeRow{row: row}
}

func newTransaction(txn *spanner.ReadWriteTransaction) transaction {
	return transaction{
		txn:        txn,
		statements: newStatements(newTxnDB(txn)),
	}
}

var _ dbold.QueryExecutor = (*transaction)(nil)

type bridgeRows struct {
	iter *spanner.RowIterator
	row  *spanner.Row
	err  error
}

func (r *bridgeRows) Next() bool {
	row, err := r.iter.Next()
	if errors.Is(err, iterator.Done) {
		return false
	}
	if err != nil {
		r.err = err
		return false
	}
	r.row = row
	return true
}

func (r *bridgeRows) Scan(dest ...any) error {
	if r.row == nil {
		return wrapError(spanner.ErrRowNotFound)
	}
	return wrapError(r.row.Columns(dest...))
}

func (r *bridgeRows) Close() error {
	r.iter.Stop()
	return wrapError(r.err)
}

func (r *bridgeRows) Err() error {
	return wrapError(r.err)
}

type bridgeRow struct {
	row *spanner.Row
	err error
}

func (r *bridgeRow) Scan(dest ...any) error {
	if r.err != nil {
		return wrapError(r.err)
	}
	if r.row == nil {
		return wrapError(spanner.ErrRowNotFound)
	}
	return wrapError(r.row.Columns(dest...))
}
