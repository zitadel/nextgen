package spanner

import (
	"context"
	"errors"

	"cloud.google.com/go/spanner"
	"google.golang.org/api/iterator"
)

type rowIterator interface {
	Do(func(*spanner.Row) error) error
	Stop()
}

type rowScanner interface {
	Scan(dest ...any) error
}

type queryExecutor interface {
	Exec(ctx context.Context, sql string, args ...any) (int64, error)
	Query(ctx context.Context, sql string, args ...any) (rowIterator, error)
	QueryRow(ctx context.Context, sql string, args ...any) rowScanner
}

type clientExecutor struct {
	client *spanner.Client
}

func newClientExecutor(client *spanner.Client) queryExecutor {
	return clientExecutor{client: client}
}

func (e clientExecutor) Exec(ctx context.Context, sql string, args ...any) (int64, error) {
	stmt := buildStatement(sql, args)
	var rowCount int64
	_, err := e.client.ReadWriteTransaction(ctx, func(ctx context.Context, txn *spanner.ReadWriteTransaction) error {
		n, err := txn.Update(ctx, toSpannerStatement(stmt))
		rowCount = n
		return err
	})
	return rowCount, wrapError(err)
}

func (e clientExecutor) Query(ctx context.Context, sql string, args ...any) (rowIterator, error) {
	stmt := buildStatement(sql, args)
	iter := e.client.Single().Query(ctx, toSpannerStatement(stmt))
	return &nativeRows{iter: iter}, nil
}

func (e clientExecutor) QueryRow(ctx context.Context, sql string, args ...any) rowScanner {
	return &clientQueryRow{
		ctx:    ctx,
		client: e.client,
		sql:    sql,
		args:   args,
	}
}

type txnExecutor struct {
	txn *spanner.ReadWriteTransaction
}

func newTxnExecutor(txn *spanner.ReadWriteTransaction) queryExecutor {
	return txnExecutor{txn: txn}
}

func (e txnExecutor) Exec(ctx context.Context, sql string, args ...any) (int64, error) {
	stmt := buildStatement(sql, args)
	n, err := e.txn.Update(ctx, toSpannerStatement(stmt))
	return n, wrapError(err)
}

func (e txnExecutor) Query(ctx context.Context, sql string, args ...any) (rowIterator, error) {
	stmt := buildStatement(sql, args)
	iter := e.txn.Query(ctx, toSpannerStatement(stmt))
	return &nativeRows{iter: iter}, nil
}

func (e txnExecutor) QueryRow(ctx context.Context, sql string, args ...any) rowScanner {
	return &txnQueryRow{
		ctx:  ctx,
		txn:  e.txn,
		sql:  sql,
		args: args,
	}
}

type nativeRows struct {
	iter *spanner.RowIterator
}

func (r *nativeRows) Do(fn func(*spanner.Row) error) error {
	return wrapError(r.iter.Do(fn))
}

func (r *nativeRows) Stop() {
	r.iter.Stop()
}

type clientQueryRow struct {
	ctx    context.Context
	client *spanner.Client
	sql    string
	args   []any
}

func (r *clientQueryRow) Scan(dest ...any) error {
	stmt := buildStatement(r.sql, r.args)
	var scanErr error
	_, err := r.client.ReadWriteTransaction(r.ctx, func(ctx context.Context, txn *spanner.ReadWriteTransaction) error {
		scanErr = scanExactlyOne(txn.Query(ctx, toSpannerStatement(stmt)), dest...)
		return scanErr
	})
	if scanErr != nil {
		return wrapError(scanErr)
	}
	return wrapError(err)
}

type txnQueryRow struct {
	ctx  context.Context
	txn  *spanner.ReadWriteTransaction
	sql  string
	args []any
}

func (r *txnQueryRow) Scan(dest ...any) error {
	stmt := buildStatement(r.sql, r.args)
	return wrapError(scanExactlyOne(r.txn.Query(r.ctx, toSpannerStatement(stmt)), dest...))
}

func scanExactlyOne(iter *spanner.RowIterator, dest ...any) error {
	defer iter.Stop()
	rowCount := 0
	err := iter.Do(func(row *spanner.Row) error {
		rowCount++
		if rowCount > 1 {
			return errTooManyRows
		}
		return row.Columns(dest...)
	})
	if err != nil {
		return err
	}
	if rowCount == 0 {
		return errNoRows
	}
	return nil
}

func collectRows[T any](iter rowIterator, scan func(*spanner.Row) (T, error)) ([]T, error) {
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

func collectExactlyOneRow[T any](iter rowIterator, scan func(*spanner.Row) (T, error)) (T, error) {
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
		return zero, wrapError(errNoRows)
	}
	return item, nil
}

func toSpannerStatement(stmt spannerStatement) spanner.Statement {
	return spanner.Statement{
		SQL:    stmt.SQL,
		Params: stmt.Params,
	}
}

// bridgeRows implements v1 [database.Rows] for the QueryExecutor bridge.
type bridgeRows struct {
	iter *spanner.RowIterator
	row  *spanner.Row
	err  error
}

func (r *bridgeRows) Next() bool {
	row, err := r.iter.Next()
	if errors.Is(err, iterator.Done) {
		return false
	}
	if err != nil {
		r.err = err
		return false
	}
	r.row = row
	return true
}

func (r *bridgeRows) Scan(dest ...any) error {
	if r.row == nil {
		return wrapError(errNoRows)
	}
	return wrapError(r.row.Columns(dest...))
}

func (r *bridgeRows) Close() error {
	r.iter.Stop()
	return wrapError(r.err)
}

func (r *bridgeRows) Err() error {
	return wrapError(r.err)
}

type bridgeRow struct {
	row *spanner.Row
	err error
}

func (r *bridgeRow) Scan(dest ...any) error {
	if r.err != nil {
		return wrapError(r.err)
	}
	if r.row == nil {
		return wrapError(errNoRows)
	}
	return wrapError(r.row.Columns(dest...))
}
