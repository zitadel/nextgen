package spanner

import (
	"context"

	"cloud.google.com/go/spanner"
)

type queryExecutor interface {
	Query(ctx context.Context, stmt spanner.Statement) *spanner.RowIterator
	Update(ctx context.Context, stmt spanner.Statement) (int64, error)
	ReadRow(ctx context.Context, table string, key spanner.Key, columns []string) (*spanner.Row, error)
}

type client struct {
	client *spanner.Client
}

func newClientDB(c *spanner.Client) queryExecutor {
	return client{client: c}
}

func (c client) Query(ctx context.Context, stmt spanner.Statement) *spanner.RowIterator {
	return c.client.Single().Query(ctx, stmt)
}

func (c client) Update(ctx context.Context, stmt spanner.Statement) (rowCount int64, _ error) {
	_, err := c.client.ReadWriteTransaction(ctx, func(ctx context.Context, txn *spanner.ReadWriteTransaction) error {
		n, err := txn.Update(ctx, stmt)
		rowCount = n
		return err
	})
	return rowCount, wrapError(err)
}

func (c client) ReadRow(ctx context.Context, table string, key spanner.Key, columns []string) (*spanner.Row, error) {
	row, err := c.client.Single().ReadRow(ctx, table, key, columns)
	return row, wrapError(err)
}

type tx struct {
	txn *spanner.ReadWriteTransaction
}

func newTxnDB(txn *spanner.ReadWriteTransaction) queryExecutor {
	return tx{txn: txn}
}

func (t tx) Query(ctx context.Context, stmt spanner.Statement) *spanner.RowIterator {
	return t.txn.Query(ctx, stmt)
}

func (t tx) Update(ctx context.Context, stmt spanner.Statement) (int64, error) {
	n, err := t.txn.Update(ctx, stmt)
	return n, wrapError(err)
}

func (t tx) ReadRow(ctx context.Context, table string, key spanner.Key, columns []string) (*spanner.Row, error) {
	row, err := t.txn.ReadRow(ctx, table, key, columns)
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
