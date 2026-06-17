package flowdefinition

import (
	"context"

	storagedb "github.com/zitadel/nextgen/internal/storage/database"
	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/query"
)

type execStmt struct {
	client storagedb.QueryExecutor
	stmt   string
	args   []any
	err    error
}

func errorExec(err error) *execStmt {
	return &execStmt{err: err}
}

func (e *execStmt) Execute(ctx context.Context) error {
	if e.err != nil {
		return e.err
	}
	_, err := e.client.Exec(ctx, e.stmt, e.args...)
	return err
}

var _ v2database.Execution = (*execStmt)(nil)

type queryStmt[R any] struct {
	client  storagedb.QueryExecutor
	compile func() (string, []any, error)
	scan    func(storagedb.Rows) (R, error)
	err     error
}

func (q *queryStmt[R]) Execute(ctx context.Context) (R, error) {
	var zero R
	if q.err != nil {
		return zero, q.err
	}
	sql, args, err := q.compile()
	if err != nil {
		return zero, err
	}
	rows, err := q.client.Query(ctx, sql, args...)
	if err != nil {
		return zero, err
	}
	defer rows.Close()
	return q.scan(rows)
}

var _ v2database.Query[query.ListResult[*struct{}]] = (*queryStmt[query.ListResult[*struct{}]])(nil)
