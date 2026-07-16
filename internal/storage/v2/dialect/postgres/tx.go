package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/zitadel/nextgen/internal/service"
	dbold "github.com/zitadel/nextgen/internal/storage/database"
)

type transaction struct {
	tx pgx.Tx
	statements
}

// Exec implements [database.QueryExecutor].
func (t transaction) Exec(ctx context.Context, stmt string, args ...any) (int64, error) {
	tag, err := t.tx.Exec(ctx, stmt, args...)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// Query implements [database.QueryExecutor].
func (t transaction) Query(ctx context.Context, stmt string, args ...any) (dbold.Rows, error) {
	r, err := t.tx.Query(ctx, stmt, args...)
	if err != nil {
		return nil, err
	}
	// TODO: wrap rows to implement dbold.Rows
	return &rows{Rows: r}, nil
}

type rows struct {
	pgx.Rows
}

func (r *rows) Close() error {
	r.Rows.Close()
	return nil
}

// QueryRow implements [database.QueryExecutor].
func (t transaction) QueryRow(ctx context.Context, stmt string, args ...any) dbold.Row {
	row := t.tx.QueryRow(ctx, stmt, args...)
	return row
}

type beginner interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

func executeTransaction(ctx context.Context, begin beginner, callback func(ctx context.Context, tx service.Statementer[service.AllStatements]) error) (err error) {
	tx, err := begin.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, tx.Rollback(ctx))
			return
		}
		err = tx.Commit(ctx)
	}()
	return callback(ctx, transaction{tx: tx, statements: newStatements(tx)})
}
