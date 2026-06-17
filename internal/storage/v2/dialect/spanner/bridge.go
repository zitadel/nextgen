package spanner

import (
	"context"
	"database/sql"

	storagedb "github.com/zitadel/nextgen/internal/storage/database"
	v1spanner "github.com/zitadel/nextgen/internal/storage/database/dialect/spanner"
	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/spanner/flowdefinition"
)

// Pool wraps the v1 Spanner pool and adds v2 [Statementer] access.
type Pool struct {
	storagedb.Pool
}

// WrapPool wraps a v1-compatible Spanner pool.
func WrapPool(pool storagedb.Pool) *Pool {
	return &Pool{Pool: pool}
}

// FlowDefinition implements [v2database.Statementer].
func (p *Pool) FlowDefinition() v2database.FlowDefinitionStatements {
	return flowdefinition.NewStatements(p.Pool)
}

// Transaction implements [v2database.Transactional].
func (p *Pool) Transaction(ctx context.Context, fn func(ctx context.Context, tx v2database.Statementer) error) error {
	return executeTransaction(ctx, p.Pool, fn)
}

var (
	_ v2database.Pool        = (*Pool)(nil)
	_ storagedb.Pool         = (*Pool)(nil)
	_ v2database.Statementer = (*Pool)(nil)
)

// Tx wraps a v1 Spanner transaction.
type Tx struct {
	storagedb.Transaction
}

// WrapTx wraps a v1 transaction.
func WrapTx(tx storagedb.Transaction) *Tx {
	return &Tx{Transaction: tx}
}

// Begin returns a wrapped transaction.
func (p *Pool) Begin(ctx context.Context, opts *storagedb.TransactionOptions) (storagedb.Transaction, error) {
	tx, err := p.Pool.Begin(ctx, opts)
	if err != nil {
		return nil, err
	}
	return WrapTx(tx), nil
}

// FlowDefinition implements [v2database.Statementer].
func (t *Tx) FlowDefinition() v2database.FlowDefinitionStatements {
	return flowdefinition.NewStatements(t.Transaction)
}

var _ v2database.Statementer = (*Tx)(nil)

// RawDB implements [storagedb.PoolTest] when the underlying pool supports it.
func (p *Pool) RawDB() *sql.DB {
	if pt, ok := p.Pool.(storagedb.PoolTest); ok {
		return pt.RawDB()
	}
	return nil
}

// MigrateTest implements [storagedb.PoolTest] when supported.
func (p *Pool) MigrateTest(ctx context.Context) error {
	if pt, ok := p.Pool.(storagedb.PoolTest); ok {
		return pt.MigrateTest(ctx)
	}
	return p.Pool.Migrate(ctx)
}

// StatementerFromClient returns a [v2database.Statementer] from a v1 client when possible.
func StatementerFromClient(client storagedb.QueryExecutor) (v2database.Statementer, bool) {
	switch c := client.(type) {
	case v2database.Statementer:
		return c, true
	case *Pool:
		return c, true
	case *Tx:
		return c, true
	case storagedb.Transaction:
		return WrapTx(c), true
	case storagedb.Pool:
		if _, ok := c.(v1spanner.SpannerPooler); ok {
			return WrapPool(c), true
		}
		return nil, false
	default:
		return nil, false
	}
}

func executeTransaction(ctx context.Context, begin storagedb.Pool, fn func(ctx context.Context, tx v2database.Statementer) error) error {
	tx, err := begin.Begin(ctx, nil)
	if err != nil {
		return err
	}
	wrapped := WrapTx(tx)
	defer func() {
		if err != nil {
			_ = wrapped.Rollback(ctx)
			return
		}
		err = wrapped.Commit(ctx)
	}()
	return fn(ctx, wrapped)
}
