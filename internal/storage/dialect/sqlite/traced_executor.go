package sqlite

import (
	"context"
	"database/sql"

	"github.com/zitadel/nextgen/internal/storage/database"
)

const dbSystem = "sqlite"

// tracedExecutor wraps every statement call in a span named after the
// statement method. It hides the BeginTx of the wrapped executor, so code
// that type-asserts an executor must look at [untraced] instead.
type tracedExecutor struct {
	next queryExecutor
}

// traced wraps e, unless it is already wrapped.
func traced(e queryExecutor) queryExecutor {
	if _, ok := e.(tracedExecutor); ok {
		return e
	}
	return tracedExecutor{next: e}
}

// untraced returns the executor that e wraps, or e itself.
func untraced(e queryExecutor) queryExecutor {
	if t, ok := e.(tracedExecutor); ok {
		return t.next
	}
	return e
}

// Exec implements [queryExecutor].
func (t tracedExecutor) Exec(ctx context.Context, query string, args ...any) (sql.Result, error) {
	ctx, end := database.StartStatementSpan(ctx, dbSystem)
	res, err := t.next.Exec(ctx, query, args...)
	end(err)
	return res, err
}

// Query implements [queryExecutor]. The span ends when Query returns, before
// the rows are read.
func (t tracedExecutor) Query(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	ctx, end := database.StartStatementSpan(ctx, dbSystem)
	rows, err := t.next.Query(ctx, query, args...)
	end(err)
	return rows, err
}

// QueryRow implements [queryExecutor].
func (t tracedExecutor) QueryRow(ctx context.Context, query string, args ...any) *sql.Row {
	ctx, end := database.StartStatementSpan(ctx, dbSystem)
	row := t.next.QueryRow(ctx, query, args...)
	end(row.Err())
	return row
}
