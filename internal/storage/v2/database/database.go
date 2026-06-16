package database

import (
	"context"
)

// Pool is a connection pool. e.g. pgxpool
type Pool interface {
	// QueryExecutor
	Tx
	Statementer

	Acquire(ctx context.Context) (Connection, error)
	Close(ctx context.Context) error

	Ping(ctx context.Context) error
}

// Connection is a single database connection which can be released back to the pool.
type Connection interface {
	// QueryExecutor
	Tx
	Statementer

	Release(ctx context.Context) error

	Ping(ctx context.Context) error
}

// Querier is a database client that can execute queries and return rows.
// type Querier interface {
// 	Query(ctx context.Context, stmt string, args ...any) (Rows, error)
// 	QueryRow(ctx context.Context, stmt string, args ...any) Row
// }

// Executor is a database client that can execute statements.
// It returns the number of rows affected or an error
// type Executor interface {
// 	Exec(ctx context.Context, stmt string, args ...any) (int64, error)
// }

// QueryExecutor is a database client that can execute queries and statements.
// type QueryExecutor interface {
// 	Querier
// 	Executor
// }

type Statementer interface {
	Statements() Statements
}

type Statement interface {
}
