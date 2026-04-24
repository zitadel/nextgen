package spanner

import (
	"context"
	"errors"

	"github.com/zitadel/nextgen/internal/storage/database"
)

type pool struct {
}

var errNotImplemented = errors.New("spanner: not implemented")

type row struct{}

func (r row) Scan(_ ...any) error {
	return errNotImplemented
}

// Acquire implements [database.Pool].
func (p *pool) Acquire(_ context.Context) (database.Connection, error) {
	return nil, errNotImplemented
}

// Begin implements [database.Pool].
func (p *pool) Begin(_ context.Context, _ *database.TransactionOptions) (database.Transaction, error) {
	return nil, errNotImplemented
}

// Close implements [database.Pool].
func (p *pool) Close(_ context.Context) error {
	return nil
}

// Exec implements [database.Pool].
func (p *pool) Exec(_ context.Context, _ string, _ ...any) (int64, error) {
	return 0, errNotImplemented
}

// Migrate implements [database.Pool].
func (p *pool) Migrate(_ context.Context) error {
	return errNotImplemented
}

// Ping implements [database.Pool].
func (p *pool) Ping(_ context.Context) error {
	return errNotImplemented
}

// Query implements [database.Pool].
func (p *pool) Query(_ context.Context, _ string, _ ...any) (database.Rows, error) {
	return nil, errNotImplemented
}

// QueryRow implements [database.Pool].
func (p *pool) QueryRow(_ context.Context, _ string, _ ...any) database.Row {
	return row{}
}

var _ database.Pool = (*pool)(nil)
