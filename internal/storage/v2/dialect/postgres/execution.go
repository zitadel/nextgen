package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

type execution struct {
	client queryExecutor
	stmt   string
	args   []any

	affectedRows int64
}

func (e *execution) Execute(ctx context.Context) error {
	res, err := e.client.Exec(ctx, e.stmt, e.args...)
	if err != nil {
		return err
	}
	e.affectedRows = res.RowsAffected()
	return nil
}

var _ database.Execution = (*execution)(nil)

type query[R any] struct {
	execution
	scan   func(pgx.Rows, *R) error
	result *R
}

func (q *query[R]) Query(ctx context.Context) (*R, error) {
	rows, err := q.client.Query(ctx, q.stmt, q.args...)
	if err != nil {
		return nil, err
	}
	if q.result == nil {
		q.result = new(R)
	}
	err = q.scan(rows, q.result)
	rows.Close()
	return q.result, errors.Join(err, rows.Err())
}

var _ database.Query[any] = (*query[any])(nil)
