package spanner

import (
	"cloud.google.com/go/spanner"
)

type transaction struct {
	txn *spanner.ReadWriteTransaction
	statements
}

func newTransaction(txn *spanner.ReadWriteTransaction) transaction {
	return transaction{
		txn:        txn,
		statements: newStatements(newTxnDB(txn)),
	}
}
