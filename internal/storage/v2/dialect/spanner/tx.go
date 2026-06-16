package spanner

import (
	"context"

	"cloud.google.com/go/spanner"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

type Transaction struct {
	tx *spanner.ReadWriteTransaction
}

// Exec implements [database.QueryExecutor].
func (t *Transaction) Exec(ctx context.Context, stmt string, args ...any) (int64, error) {
	t.tx.Query()
	panic("unimplemented")
}

// Query implements [database.QueryExecutor].
func (t *Transaction) Query(ctx context.Context, stmt string, args ...any) (database.Rows, error) {
	panic("unimplemented")
}

// QueryRow implements [database.QueryExecutor].
func (t *Transaction) QueryRow(ctx context.Context, stmt string, args ...any) database.Row {
	panic("unimplemented")
}

var _ database.QueryExecutor = (*Transaction)(nil)

type Statement struct {
	stmt spanner.Statement
}
