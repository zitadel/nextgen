package spanner

import (
	"context"
	"errors"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/storage/database"
)

type queryExecutor interface {
	// Query reads data from the database and calls the consume callback with a RowIterator to process the results.
	// It must not be used for writing data.
	Query(ctx context.Context, stmt spanner.Statement, consume func(*spanner.RowIterator) error) error
	// Write executes a write operation on the database and calls the consume callback with a RowIterator to process the results.
	// It should be used to write data and read the results back in a single transaction. Use [client.Query] is not suitable for reading data without writing.
	Write(ctx context.Context, stmt spanner.Statement, consume func(*spanner.RowIterator) error) error
	// Update executes a write operation on the database and returns the number of rows affected.
	// It must not be used for reading data.
	Update(ctx context.Context, stmt spanner.Statement) (int64, error)
	// ReadRow reads a single row from the database and returns it. It must not be used for writing data.
	ReadRow(ctx context.Context, table string, key spanner.Key, columns []string) (*spanner.Row, error)
}

type client struct {
	client *spanner.Client
}

func newClientDB(c *spanner.Client) queryExecutor {
	return client{client: c}
}

// Query implements [queryExecutor].
func (c client) Query(ctx context.Context, stmt spanner.Statement, consume func(*spanner.RowIterator) error) error {
	tx := c.client.Single()
	defer tx.Close()
	iter := tx.Query(ctx, stmt)
	defer iter.Stop()
	return consume(iter)
}

// Write implements [queryExecutor].
func (c client) Write(ctx context.Context, stmt spanner.Statement, consume func(*spanner.RowIterator) error) error {
	ctx, cancel := boundRetry(ctx)
	defer cancel()

	_, err := c.client.ReadWriteTransaction(ctx, func(ctx context.Context, rwt *spanner.ReadWriteTransaction) error {
		iter := rwt.Query(ctx, stmt)
		defer iter.Stop()
		return consume(iter)
	})
	return returnQueryError(err)
}

// Update implements [queryExecutor].
func (c client) Update(ctx context.Context, stmt spanner.Statement) (rowCount int64, _ error) {
	ctx, cancel := boundRetry(ctx)
	defer cancel()

	_, err := c.client.ReadWriteTransaction(ctx, func(ctx context.Context, txn *spanner.ReadWriteTransaction) error {
		n, err := txn.Update(ctx, stmt)
		rowCount = n
		return err
	})
	return rowCount, wrapError(err)
}

func (c client) ReadRow(ctx context.Context, table string, key spanner.Key, columns []string) (*spanner.Row, error) {
	tx := c.client.Single()
	defer tx.Close()
	row, err := tx.ReadRow(ctx, table, key, columns)
	return row, returnQueryError(err)
}

type tx struct {
	txn *spanner.ReadWriteTransaction
}

func newTxnDB(txn *spanner.ReadWriteTransaction) queryExecutor {
	return tx{txn: txn}
}

// Query implements [queryExecutor].
func (t tx) Query(ctx context.Context, stmt spanner.Statement, consume func(*spanner.RowIterator) error) error {
	return returnQueryError(consume(t.txn.Query(ctx, stmt)))
}

// Write implements [queryExecutor].
func (t tx) Write(ctx context.Context, stmt spanner.Statement, consume func(*spanner.RowIterator) error) error {
	iter := t.txn.Query(ctx, stmt)
	defer iter.Stop()
	return returnQueryError(consume(iter))
}

// Update implements [queryExecutor].
func (t tx) Update(ctx context.Context, stmt spanner.Statement) (int64, error) {
	n, err := t.txn.Update(ctx, stmt)
	return n, wrapError(err)
}

// ReadRow implements [queryExecutor].
func (t tx) ReadRow(ctx context.Context, table string, key spanner.Key, columns []string) (*spanner.Row, error) {
	row, err := t.txn.ReadRow(ctx, table, key, columns)
	return row, returnQueryError(err)
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

// returnQueryError preserves errors already mapped by collect*/wrapError from
// the consume callback, and only wraps raw Spanner/commit failures.
func returnQueryError(err error) error {
	if err == nil {
		return nil
	}
	if isWrappedStorageError(err) {
		return err
	}
	return wrapError(err)
}

func isWrappedStorageError(err error) bool {
	var (
		noRow   *database.NoRowFoundError
		multi   *database.MultipleRowsFoundError
		unique  *database.UniqueError
		check   *database.CheckError
		scan    *database.ScanError
		unknown *database.UnknownError
	)
	return errors.As(err, &noRow) ||
		errors.As(err, &multi) ||
		errors.As(err, &unique) ||
		errors.As(err, &check) ||
		errors.As(err, &scan) ||
		errors.As(err, &unknown)
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
