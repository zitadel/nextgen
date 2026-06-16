package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

type execution struct {
	client queryExecutor
	stmt   string
	scan   func(pgx.Rows) error
	args   []any
	fn     func(ctx context.Context) error
}

func (e execution) Execute(ctx context.Context) error {
	if e.scan == nil {
		return e.fn(ctx)
	}
	rows, err := e.client.Query(ctx, e.stmt, e.args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	return e.scan(rows)
}

var _ database.Execution = (*execution)(nil)

type query[R any] struct {
	execution
	result R
}

func (q query[R]) Execute(ctx context.Context) (R, error) {
	err := q.execution.Execute(ctx)
	return q.result, err
}

var _ database.Query[any] = (*query[any])(nil)
