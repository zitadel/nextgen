package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"

	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres/migration"
)

type pgxConn struct {
	*pgxpool.Conn
	pool *pgxpool.Pool
}

var _ database.Connection = (*pgxConn)(nil)

// Release implements [database.Connection].
func (c *pgxConn) Release(_ context.Context) error {
	c.Conn.Release()
	return nil
}

// Begin implements [database.Connection].
func (c *pgxConn) Begin(ctx context.Context, opts *database.TransactionOptions) (database.Transaction, error) {
	tx, err := c.BeginTx(ctx, transactionOptionsToPgx(opts))
	if err != nil {
		return nil, wrapError(err)
	}
	return PGxTx(tx), nil
}

// Query implements [database.Connection].
// Subtle: this method shadows the method (*Conn).Query of [pgxConn.Conn].
func (c *pgxConn) Query(ctx context.Context, sql string, args ...any) (database.Rows, error) {
	rows, err := c.Conn.Query(ctx, sql, args...)
	if err != nil {
		return nil, wrapError(err)
	}
	return newRows(rows), nil
}

// QueryRow implements [database.Connection].
// Subtle: this method shadows the method (*Conn).QueryRow of [pgxConn.Conn].
func (c *pgxConn) QueryRow(ctx context.Context, sql string, args ...any) database.Row {
	return newRow(c.Conn.QueryRow(ctx, sql, args...))
}

// QueryRow implements [database.Connection].
// Subtle: this method shadows the method (*Conn).QueryRow of [pgxConn.Conn].
func (c *pgxConn) Exec(ctx context.Context, sql string, args ...any) (int64, error) {
	res, err := c.Conn.Exec(ctx, sql, args...)
	if err != nil {
		return 0, wrapError(err)
	}
	return res.RowsAffected(), nil
}

// Ping implements [database.Pool].
func (c *pgxConn) Ping(ctx context.Context) error {
	return wrapError(c.Conn.Ping(ctx))
}

// Migrate implements [database.Migrator].
func (c *pgxConn) Migrate(ctx context.Context) error {
	if isMigrated {
		return nil
	}
	db := stdlib.OpenDBFromPool(c.pool)
	defer db.Close()
	err := migration.Migrate(ctx, db)
	isMigrated = err == nil
	return wrapError(err)
}
