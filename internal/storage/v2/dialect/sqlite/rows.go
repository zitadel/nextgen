package sqlite

import (
	"context"
	"database/sql"
)

func collectRows[T any](rows *sql.Rows, scan func(*sql.Rows) (T, error)) ([]T, error) {
	var items []T
	for rows.Next() {
		item, err := scan(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func collectExactlyOneRow[T any](rows *sql.Rows, scan func(*sql.Rows) (T, error)) (T, error) {
	var (
		zero T
		item T
		n    int
	)
	for rows.Next() {
		n++
		if n > 1 {
			return zero, errTooManyRows
		}
		var err error
		item, err = scan(rows)
		if err != nil {
			return zero, err
		}
	}
	if err := rows.Err(); err != nil {
		return zero, err
	}
	if n == 0 {
		return zero, sql.ErrNoRows
	}
	return item, nil
}

func execAffected(ctx context.Context, client queryExecutor, query string, args ...any) (int64, error) {
	result, err := client.Exec(ctx, query, args...)
	if err != nil {
		return 0, wrapError(err)
	}
	n, err := result.RowsAffected()
	if err != nil {
		return 0, wrapError(err)
	}
	return n, nil
}
