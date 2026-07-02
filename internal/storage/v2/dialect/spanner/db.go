package spanner

import (
	"context"
	"errors"

	"cloud.google.com/go/spanner"
)

type spannerDB interface {
	Query(ctx context.Context, stmt spanner.Statement) *spanner.RowIterator
	Update(ctx context.Context, stmt spanner.Statement) (int64, error)
	ReadRow(ctx context.Context, table string, key spanner.Key, columns []string) (*spanner.Row, error)
}

type clientDB struct {
	client *spanner.Client
}

func newClientDB(client *spanner.Client) spannerDB {
	return clientDB{client: client}
}

func (d clientDB) Query(ctx context.Context, stmt spanner.Statement) *spanner.RowIterator {
	return d.client.Single().Query(ctx, stmt)
}

func (d clientDB) Update(ctx context.Context, stmt spanner.Statement) (int64, error) {
	var rowCount int64
	_, err := d.client.ReadWriteTransaction(ctx, func(ctx context.Context, txn *spanner.ReadWriteTransaction) error {
		n, err := txn.Update(ctx, stmt)
		rowCount = n
		return err
	})
	return rowCount, wrapError(err)
}

func (d clientDB) ReadRow(ctx context.Context, table string, key spanner.Key, columns []string) (*spanner.Row, error) {
	row, err := d.client.Single().ReadRow(ctx, table, key, columns)
	return row, wrapError(err)
}

type txnDB struct {
	txn *spanner.ReadWriteTransaction
}

func newTxnDB(txn *spanner.ReadWriteTransaction) spannerDB {
	return txnDB{txn: txn}
}

func (d txnDB) Query(ctx context.Context, stmt spanner.Statement) *spanner.RowIterator {
	return d.txn.Query(ctx, stmt)
}

func (d txnDB) Update(ctx context.Context, stmt spanner.Statement) (int64, error) {
	n, err := d.txn.Update(ctx, stmt)
	return n, wrapError(err)
}

func (d txnDB) ReadRow(ctx context.Context, table string, key spanner.Key, columns []string) (*spanner.Row, error) {
	row, err := d.txn.ReadRow(ctx, table, key, columns)
	return row, wrapError(err)
}

func (s spannerStatement) statement() spanner.Statement {
	return spanner.Statement{
		SQL:    s.SQL,
		Params: s.Params,
	}
}

func (c *statementCompiler) statement() spanner.Statement {
	return buildStatement(c.String(), c.args...).statement()
}

func collectRows[T any](iter *spanner.RowIterator, scan func(*spanner.Row) (T, error)) ([]T, error) {
	defer iter.Stop()
	var items []T
	err := iter.Do(func(row *spanner.Row) error {
		item, err := scan(row)
		if err != nil {
			return err
		}
		items = append(items, item)
		return nil
	})
	if err != nil {
		return nil, wrapError(err)
	}
	return items, nil
}

func collectOneRow[T any](iter *spanner.RowIterator, scan func(*spanner.Row) (T, error)) (T, error) {
	defer iter.Stop()
	var (
		zero     T
		rowCount int
		item     T
	)
	err := iter.Do(func(row *spanner.Row) error {
		rowCount++
		if rowCount > 1 {
			return errTooManyRows
		}
		scanned, err := scan(row)
		if err != nil {
			return err
		}
		item = scanned
		return nil
	})
	if err != nil {
		return zero, wrapError(err)
	}
	if rowCount == 0 {
		return zero, wrapError(spanner.ErrRowNotFound)
	}
	return item, nil
}

var errTooManyRows = errors.New("spanner: multiple rows in result set")
