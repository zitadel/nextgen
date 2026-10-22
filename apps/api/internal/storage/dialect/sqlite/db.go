package sqlite

import (
	"context"
	"database/sql"
)

// db wraps *sql.DB to implement queryExecutor.
type db struct{ sqlDB *sql.DB }

// Exec implements queryExecutor.
func (d db) Exec(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return d.sqlDB.ExecContext(ctx, query, args...)
}

// Query implements queryExecutor.
func (d db) Query(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return d.sqlDB.QueryContext(ctx, query, args...)
}

// QueryRow implements queryExecutor.
func (d db) QueryRow(ctx context.Context, query string, args ...any) *sql.Row {
	return d.sqlDB.QueryRowContext(ctx, query, args...)
}

// BeginTx begins a new transaction on the underlying *sql.DB.
func (d db) BeginTx(ctx context.Context, opts *sql.TxOptions) (*sql.Tx, error) {
	return d.sqlDB.BeginTx(ctx, opts)
}

// txExecutor wraps *sql.Tx to implement queryExecutor.
type txExecutor struct{ sqlTx *sql.Tx }

// Exec implements queryExecutor.
func (t txExecutor) Exec(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return t.sqlTx.ExecContext(ctx, query, args...)
}

// Query implements queryExecutor.
func (t txExecutor) Query(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return t.sqlTx.QueryContext(ctx, query, args...)
}

// QueryRow implements queryExecutor.
func (t txExecutor) QueryRow(ctx context.Context, query string, args ...any) *sql.Row {
	return t.sqlTx.QueryRowContext(ctx, query, args...)
}
