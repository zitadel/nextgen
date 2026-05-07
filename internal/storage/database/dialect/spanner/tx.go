package spanner

import (
	"github.com/jackc/pgx/v5"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/pgxcommon"
)

type Transaction struct {
	*pgxcommon.Transaction
}

var _ database.Transaction = (*Transaction)(nil)
var _ SpannerPooler = (*Transaction)(nil)

func (p *Transaction) isSpanner() {}

func newTransaction(tx pgx.Tx) *Transaction {
	return &Transaction{pgxcommon.NewTransaction(tx, wrapError)}
}

func transactionOptionsToPgx(opts *database.TransactionOptions) pgx.TxOptions {
	return pgxcommon.TransactionOptionsToPgx(opts)
}
