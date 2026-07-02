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
func (t transaction) Exec(ctx context.Context, stmt string, args ...any) (int64, error) {
	s := buildStatementFromPostgresSQL(stmt, args)
	n, err := t.txn.Update(ctx, toSpannerStatement(s))
	return n, wrapError(err)
}

// Query implements [database.QueryExecutor].
func (t transaction) Query(ctx context.Context, stmt string, args ...any) (dbold.Rows, error) {
	s := buildStatementFromPostgresSQL(stmt, args)
	iter := t.txn.Query(ctx, toSpannerStatement(s))
	return &bridgeRows{iter: iter}, nil
}

// QueryRow implements [database.QueryExecutor].
func (t transaction) QueryRow(ctx context.Context, stmt string, args ...any) dbold.Row {
	s := buildStatementFromPostgresSQL(stmt, args)
	iter := t.txn.Query(ctx, toSpannerStatement(s))
	row, err := iter.Next()
	iter.Stop()
	if errors.Is(err, iterator.Done) {
		return &bridgeRow{err: errNoRows}
	}
	if err != nil {
		return &bridgeRow{err: err}
	}
	return &bridgeRow{row: row}
}

func newTransaction(txn *spanner.ReadWriteTransaction) transaction {
	return transaction{
		txn:        txn,
		statements: newStatements(newTxnExecutor(txn)),
	}
}

var _ dbold.QueryExecutor = (*transaction)(nil)
