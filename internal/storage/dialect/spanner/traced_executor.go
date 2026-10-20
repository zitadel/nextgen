package spanner

import (
	"context"

	"cloud.google.com/go/spanner"

	"github.com/zitadel/nextgen/internal/storage/database"
)

const dbSystem = "gcp.spanner"

// tracedExecutor wraps every statement call in a span named after the
// statement method. It hides the type of the wrapped executor, so code that
// switches on an executor must look at [untraced] instead.
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

// Query implements [queryExecutor]. The span covers consume, where the rows
// are read.
func (t tracedExecutor) Query(ctx context.Context, stmt spanner.Statement, consume func(*spanner.RowIterator) error) error {
	ctx, end := database.StartStatementSpan(ctx, dbSystem)
	err := t.next.Query(ctx, stmt, consume)
	end(err)
	return err
}

// Write implements [queryExecutor]. The span covers consume, where the rows
// are read.
func (t tracedExecutor) Write(ctx context.Context, stmt spanner.Statement, consume func(*spanner.RowIterator) error) error {
	ctx, end := database.StartStatementSpan(ctx, dbSystem)
	err := t.next.Write(ctx, stmt, consume)
	end(err)
	return err
}

// Update implements [queryExecutor].
func (t tracedExecutor) Update(ctx context.Context, stmt spanner.Statement) (int64, error) {
	ctx, end := database.StartStatementSpan(ctx, dbSystem)
	n, err := t.next.Update(ctx, stmt)
	end(err)
	return n, err
}

// BufferWrite implements [queryExecutor].
func (t tracedExecutor) BufferWrite(ctx context.Context, ms []*spanner.Mutation) error {
	ctx, end := database.StartStatementSpan(ctx, dbSystem)
	err := t.next.BufferWrite(ctx, ms)
	end(err)
	return err
}

// ReadRow implements [queryExecutor].
func (t tracedExecutor) ReadRow(ctx context.Context, table string, key spanner.Key, columns []string) (*spanner.Row, error) {
	ctx, end := database.StartStatementSpan(ctx, dbSystem)
	row, err := t.next.ReadRow(ctx, table, key, columns)
	end(err)
	return row, err
}
