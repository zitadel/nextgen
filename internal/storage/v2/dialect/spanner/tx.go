package spanner

import (
	"cloud.google.com/go/spanner"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

type Transaction struct {
	tx *spanner.ReadWriteTransaction
	statements
}

func newTransaction(tx *spanner.ReadWriteTransaction) *Transaction {
	return &Transaction{
		tx:         tx,
		statements: statements{client: tx},
	}
}

var _ database.Statementer = (*Transaction)(nil)

type Statement struct {
	stmt spanner.Statement
}
