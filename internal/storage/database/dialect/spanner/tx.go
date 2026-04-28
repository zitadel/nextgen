package spanner

import (
	"github.com/jackc/pgx/v5"

	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/pgxcommon"
)

// Transaction is a type alias so that callers referencing spanner.Transaction still compile.
type Transaction = pgxcommon.Transaction

var _ database.Transaction = (*Transaction)(nil)

func newTransaction(tx pgx.Tx) *Transaction {
	return pgxcommon.NewTransaction(tx, wrapError)
}

func transactionOptionsToPgx(opts *database.TransactionOptions) pgx.TxOptions {
	return pgxcommon.TransactionOptionsToPgx(opts)
}
