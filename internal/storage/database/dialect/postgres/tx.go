package postgres

import (
	"github.com/jackc/pgx/v5"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/pgxcommon"
)

type Transaction struct {
	*pgxcommon.Transaction
}

var _ database.Transaction = (*Transaction)(nil)
var _ PostgresPooler = (*Transaction)(nil)

func (p *Transaction) isPostgres() {}

// PGxTx wraps an existing pgx.Tx in a postgres-dialect transaction.
func PGxTx(tx pgx.Tx) *Transaction {
	return &Transaction{pgxcommon.NewTransaction(tx, wrapError)}
}

func transactionOptionsToPgx(opts *database.TransactionOptions) pgx.TxOptions {
	return pgxcommon.TransactionOptionsToPgx(opts)
}
