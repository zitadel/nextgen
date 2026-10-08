package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	pgschema "github.com/zitadel/nextgen/internal/storage/dialect/postgres/schema"
)

// poolClient is what statements and transactions are built on: the pool
// itself for the default schema, or a wrapper that redirects the schema of
// every statement before it reaches the server.
type poolClient interface {
	queryExecutor
	beginner
}

func clientFor(pool *pgxpool.Pool, schema string) poolClient {
	if schema == pgschema.Default {
		return pool
	}
	return schemaPool{Pool: pool, schema: schema}
}

// schemaPool runs every statement in a non-default schema. The statements
// are written for the default schema; see [pgschema.Rewrite].
type schemaPool struct {
	*pgxpool.Pool
	schema string
}

func (p schemaPool) Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error) {
	return p.Pool.Exec(ctx, pgschema.Rewrite(sql, p.schema), arguments...)
}

func (p schemaPool) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	return p.Pool.Query(ctx, pgschema.Rewrite(sql, p.schema), args...)
}

func (p schemaPool) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return p.Pool.QueryRow(ctx, pgschema.Rewrite(sql, p.schema), args...)
}

// Begin opens a transaction whose statements are redirected the same way.
func (p schemaPool) Begin(ctx context.Context) (pgx.Tx, error) {
	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	return schemaTx{Tx: tx, schema: p.schema}, nil
}

// schemaTx is the transaction counterpart of schemaPool. Nested Begin calls
// (savepoints, see withTransaction) stay redirected.
type schemaTx struct {
	pgx.Tx
	schema string
}

func (t schemaTx) Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error) {
	return t.Tx.Exec(ctx, pgschema.Rewrite(sql, t.schema), arguments...)
}

func (t schemaTx) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	return t.Tx.Query(ctx, pgschema.Rewrite(sql, t.schema), args...)
}

func (t schemaTx) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return t.Tx.QueryRow(ctx, pgschema.Rewrite(sql, t.schema), args...)
}

func (t schemaTx) Begin(ctx context.Context) (pgx.Tx, error) {
	tx, err := t.Tx.Begin(ctx)
	if err != nil {
		return nil, err
	}
	return schemaTx{Tx: tx, schema: t.schema}, nil
}

var (
	_ poolClient = (*pgxpool.Pool)(nil)
	_ poolClient = schemaPool{}
	_ pgx.Tx     = schemaTx{}
)
