package postgres

import (
	"context"
	"database/sql"

	storagedb "github.com/zitadel/nextgen/internal/storage/database"
	v1postgres "github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/postgres/flowdefinition"
)

// Pool wraps the v1 Postgres pool and adds v2 [Statementer] access.
type Pool struct {
	*v1postgres.Pool
}

// WrapPool wraps a v1 Postgres pool as a v2 pool.
func WrapPool(pool *v1postgres.Pool) *Pool {
	return &Pool{Pool: pool}
}

// ConnectPool wraps an existing v1 Postgres pool as a v2 pool.
func ConnectPool(pool *v1postgres.Pool) *Pool {
	return WrapPool(pool)
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
	_ storagedb.PoolTest     = (*Pool)(nil)
	_ v2database.Statementer = (*Pool)(nil)
)

// Tx wraps a v1 transaction with v2 statement access.
type Tx struct {
	storagedb.Transaction
}

// WrapTx wraps a v1 transaction.
func WrapTx(tx storagedb.Transaction) *Tx {
	return &Tx{Transaction: tx}
}

// Begin returns a v2-wrapped transaction.
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

// RawDB implements [storagedb.PoolTest].
func (p *Pool) RawDB() *sql.DB {
	return p.Pool.RawDB()
}

// MigrateTest implements [storagedb.PoolTest].
func (p *Pool) MigrateTest(ctx context.Context) error {
	return p.Pool.MigrateTest(ctx)
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
		if pg, ok := c.(*v1postgres.Pool); ok {
			return WrapPool(pg), true
		}
		return nil, false
	default:
		return nil, false
	}
}
