package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/zitadel/nextgen/internal/instrumentation/metrics"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// meteredPool and meteredTx time every statement call as the statement
// duration metric. They embed the pgx type they wrap, so everything they do not
// override (Commit, Rollback, CopyFrom, ...) is the wrapped type's own, and they
// still satisfy the `Begin` check in [withTransaction]: a Begin returns a
// meteredTx, so the statements of a transaction are timed as well.
//
// A Query is timed until it returns, before its rows are read, and a QueryRow
// until its Scan, because pgx reports that row's error there.
type (
	meteredPool struct{ *pgxpool.Pool }
	meteredTx   struct{ pgx.Tx }
)

func observe(ctx context.Context) database.StatementTimer {
	return database.ObserveStatement(ctx, metrics.DialectPostgres)
}

// Exec implements [queryExecutor].
func (p meteredPool) Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error) {
	defer observe(ctx).Done()
	return p.Pool.Exec(ctx, sql, arguments...)
}

// Query implements [queryExecutor].
func (p meteredPool) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	defer observe(ctx).Done()
	return p.Pool.Query(ctx, sql, args...)
}

// QueryRow implements [queryExecutor].
func (p meteredPool) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return meteredRow{row: p.Pool.QueryRow(ctx, sql, args...), timer: observe(ctx)}
}

// Begin starts a transaction whose statements are timed.
func (p meteredPool) Begin(ctx context.Context) (pgx.Tx, error) {
	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	return meteredTx{tx}, nil
}

// Exec implements [queryExecutor].
func (t meteredTx) Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error) {
	defer observe(ctx).Done()
	return t.Tx.Exec(ctx, sql, arguments...)
}

// Query implements [queryExecutor].
func (t meteredTx) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	defer observe(ctx).Done()
	return t.Tx.Query(ctx, sql, args...)
}

// QueryRow implements [queryExecutor].
func (t meteredTx) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return meteredRow{row: t.Tx.QueryRow(ctx, sql, args...), timer: observe(ctx)}
}

// Begin starts a savepoint whose statements are timed.
func (t meteredTx) Begin(ctx context.Context) (pgx.Tx, error) {
	tx, err := t.Tx.Begin(ctx)
	if err != nil {
		return nil, err
	}
	return meteredTx{tx}, nil
}

type meteredRow struct {
	row   pgx.Row
	timer database.StatementTimer
}

// Scan implements [pgx.Row].
func (r meteredRow) Scan(dest ...any) error {
	defer r.timer.Done()
	return r.row.Scan(dest...)
}

var (
	_ queryExecutor = meteredPool{}
	_ queryExecutor = meteredTx{}
)
