package spanner

import (
	"context"
	"database/sql"

	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/spanner/migration"
)

type spannerPool struct {
	db         *sql.DB
	isMigrated bool
}

type SpannerPooler interface {
	isSpanner()
}

var _ database.Pool = (*spannerPool)(nil)
var _ database.PoolTest = (*spannerPool)(nil)
var _ SpannerPooler = (*spannerPool)(nil)

func (p *spannerPool) isSpanner() {}

// RawDB implements [database.PoolTest].
func (p *spannerPool) RawDB() *sql.DB { return p.db }

// Acquire implements [database.Pool].
func (p *spannerPool) Acquire(ctx context.Context) (database.Connection, error) {
	conn, err := p.db.Conn(ctx)
	if err != nil {
		return nil, wrapError(err)
	}
	return &spannerConn{conn: conn, pool: p}, nil
}

// Query implements [database.Pool].
func (p *spannerPool) Query(ctx context.Context, query string, args ...any) (database.Rows, error) {
	rows, err := p.db.QueryContext(ctx, convertPlaceholders(query), args...)
	if err != nil {
		return nil, wrapError(err)
	}
	return newRows(rows), nil
}

// QueryRow implements [database.Pool].
func (p *spannerPool) QueryRow(ctx context.Context, query string, args ...any) database.Row {
	return newRow(p.db.QueryRowContext(ctx, convertPlaceholders(query), args...))
}

// Exec implements [database.Pool].
func (p *spannerPool) Exec(ctx context.Context, query string, args ...any) (int64, error) {
	res, err := p.db.ExecContext(ctx, convertPlaceholders(query), args...)
	if err != nil {
		return 0, wrapError(err)
	}
	n, err := res.RowsAffected()
	return n, wrapError(err)
}

// Begin implements [database.Pool].
func (p *spannerPool) Begin(ctx context.Context, opts *database.TransactionOptions) (database.Transaction, error) {
	tx, err := p.db.BeginTx(ctx, transactionOptions(opts))
	if err != nil {
		return nil, wrapError(err)
	}
	return newTransaction(tx), nil
}

// Close implements [database.Pool].
func (p *spannerPool) Close(_ context.Context) error {
	return wrapError(p.db.Close())
}

// Ping implements [database.Pool].
func (p *spannerPool) Ping(ctx context.Context) error {
	return wrapError(p.db.PingContext(ctx))
}

// Migrate implements [database.Migrator].
func (p *spannerPool) Migrate(ctx context.Context) error {
	if p.isMigrated {
		return nil
	}
	err := migration.Migrate(ctx, p.db)
	p.isMigrated = err == nil
	return wrapError(err)
}

// MigrateTest implements [database.PoolTest].
func (p *spannerPool) MigrateTest(ctx context.Context) error {
	err := migration.Migrate(ctx, p.db)
	p.isMigrated = err == nil
	return err
}
