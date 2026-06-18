package sql

import (
	"context"
	"database/sql"
)

// Pool is a connection pool. e.g. pgxpool
type Pool interface {
	Beginner
	QueryExecutor
	// Migrator

	Acquire(ctx context.Context) (Connection, error)
	Close(ctx context.Context) error

	Ping(ctx context.Context) error
}

type PoolTest interface {
	Pool
	// MigrateTest is the same as [Migrator] but executes the migrations multiple times instead of only once.
	MigrateTest(ctx context.Context) error
	// RawDB returns an *[sql.DB] handle backed by the same database as the [PoolTest].
	// The returned handle is intended for use in tests, and the caller is responsible for closing it when done.
	RawDB() *sql.DB
}

// Connection is a single database connection which can be released back to the pool.
type Connection interface {
	Beginner
	QueryExecutor
	// Migrator

	Release(ctx context.Context) error

	Ping(ctx context.Context) error
}

// Querier is a database client that can execute queries and return rows.
type Querier interface {
	Query(ctx context.Context, stmt string, args ...any) (Rows, error)
	QueryRow(ctx context.Context, stmt string, args ...any) Row
}

// Executor is a database client that can execute statements.
// It returns the number of rows affected or an error
type Executor interface {
	Exec(ctx context.Context, stmt string, args ...any) (int64, error)
}

// QueryExecutor is a database client that can execute queries and statements.
type QueryExecutor interface {
	Querier
	Executor
}

// Scanner scans a single row of data into the destination.
type Scanner interface {
	Scan(dest ...any) error
}

// Row is an abstraction of sql.Row.
type Row interface {
	Scanner
}

// Rows is an abstraction of sql.Rows.
type Rows interface {
	Scanner
	Next() bool
	Close() error
	Err() error
}
