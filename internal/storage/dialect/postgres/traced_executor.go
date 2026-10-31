package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const dbSystem = metrics.DBSystemPostgreSQL

// tracedExecutor traces and times every statement call under the name of the
// statement method, through [database.StartStatement]. It hides the Begin of
// the wrapped executor, so code that type-asserts an executor must look at
// [untraced] instead.
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
func (t tracedExecutor) Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error) {
	ctx, end := database.StartStatement(ctx, dbSystem)
	tag, err := t.next.Exec(ctx, sql, arguments...)
	end(err)
	return tag, err
}

// Query implements [queryExecutor]. The span and the timing end when Query
// returns, before the rows are read; the pgx query span covers the wire time.
func (t tracedExecutor) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	ctx, end := database.StartStatement(ctx, dbSystem)
	rows, err := t.next.Query(ctx, sql, args...)
	end(err)
	return rows, err
}

// QueryRow implements [queryExecutor]. pgx reports the error on Scan, so the
// span and the timing end there.
func (t tracedExecutor) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	ctx, end := database.StartStatement(ctx, dbSystem)
	return tracedRow{row: t.next.QueryRow(ctx, sql, args...), end: end}
}

type tracedRow struct {
	row pgx.Row
	end func(error)
}

// Scan implements [pgx.Row].
func (r tracedRow) Scan(dest ...any) error {
	err := r.row.Scan(dest...)
	r.end(err)
	return err
}
