package flowdefinition

import (
	"context"
	"strings"

	storagedb "github.com/zitadel/nextgen/internal/storage/database"
	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/query"
)

// SQLClient runs SQL through the v1 Spanner sql.DB bridge.
type SQLClient struct {
	storagedb.QueryExecutor
}

func (c SQLClient) Query(ctx context.Context, sql string, args ...any) (storagedb.Rows, error) {
	return c.QueryExecutor.Query(ctx, convertPlaceholders(sql), args...)
}

func (c SQLClient) Exec(ctx context.Context, sql string, args ...any) (int64, error) {
	return c.QueryExecutor.Exec(ctx, convertPlaceholders(sql), args...)
}

func convertPlaceholders(sql string) string {
	var b strings.Builder
	b.Grow(len(sql))
	inQuote := false
	i := 0
	for i < len(sql) {
		ch := sql[i]
		if ch == '\'' {
			inQuote = !inQuote
			b.WriteByte(ch)
			i++
			continue
		}
		if !inQuote && ch == '$' && i+1 < len(sql) && sql[i+1] >= '0' && sql[i+1] <= '9' {
			b.WriteString("@p")
			i++
			for i < len(sql) && sql[i] >= '0' && sql[i] <= '9' {
				b.WriteByte(sql[i])
				i++
			}
			continue
		}
		b.WriteByte(ch)
		i++
	}
	return b.String()
}

type execStmt struct {
	client SQLClient
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
	client  SQLClient
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
