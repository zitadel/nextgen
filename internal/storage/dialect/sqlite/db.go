package sqlite

import (
	"context"
	"database/sql"

	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// Both executors time every call they make, whole, as the statement duration
// metric. A BeginTx is not a statement and is not timed.

// db wraps *sql.DB to implement queryExecutor.
type db struct{ sqlDB *sql.DB }

// Exec implements queryExecutor.
func (d db) Exec(ctx context.Context, query string, args ...any) (sql.Result, error) {
	defer database.ObserveStatement(ctx, metrics.DialectSQLite).Done()
	return d.sqlDB.ExecContext(ctx, query, args...)
}

// Query implements queryExecutor.
func (d db) Query(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	defer database.ObserveStatement(ctx, metrics.DialectSQLite).Done()
	return d.sqlDB.QueryContext(ctx, query, args...)
}

// QueryRow implements queryExecutor.
func (d db) QueryRow(ctx context.Context, query string, args ...any) *sql.Row {
	defer database.ObserveStatement(ctx, metrics.DialectSQLite).Done()
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
	defer database.ObserveStatement(ctx, metrics.DialectSQLite).Done()
	return t.sqlTx.ExecContext(ctx, query, args...)
}

// Query implements queryExecutor.
func (t txExecutor) Query(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	defer database.ObserveStatement(ctx, metrics.DialectSQLite).Done()
	return t.sqlTx.QueryContext(ctx, query, args...)
}

// QueryRow implements queryExecutor.
func (t txExecutor) QueryRow(ctx context.Context, query string, args ...any) *sql.Row {
	defer database.ObserveStatement(ctx, metrics.DialectSQLite).Done()
	return t.sqlTx.QueryRowContext(ctx, query, args...)
}
