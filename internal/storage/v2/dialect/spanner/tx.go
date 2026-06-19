package spanner

import (
	"context"

	"cloud.google.com/go/spanner"
	dbold "github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

type Transaction struct {
	tx *spanner.ReadWriteTransaction
	statements
}

// Exec implements [database.QueryExecutor].
func (t *Transaction) Exec(ctx context.Context, stmt string, args ...any) (int64, error) {
	panic("unimplemented")
}

// Query implements [database.QueryExecutor].
func (t *Transaction) Query(ctx context.Context, stmt string, args ...any) (dbold.Rows, error) {
	panic("unimplemented")
}

// QueryRow implements [database.QueryExecutor].
func (t *Transaction) QueryRow(ctx context.Context, stmt string, args ...any) dbold.Row {
	panic("unimplemented")
}

func newTransaction(tx *spanner.ReadWriteTransaction) *Transaction {
	return &Transaction{
		tx:         tx,
		statements: newStatements(tx),
	}
}

type Statement struct {
	stmt spanner.Statement
}

var (
	_ database.Transaction = (*Transaction)(nil)
	_ dbold.QueryExecutor  = (*Transaction)(nil)
)
