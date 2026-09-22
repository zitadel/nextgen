package configfs

import (
	"context"

	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// Pool serves the configuration kinds from a project directory and everything
// else from a SQL pool.
//
// It is a decorator, not a dialect of its own: migrations, connection health
// and every statement this package does not override belong to the wrapped
// pool and are passed straight through. The one thing it adds is the routing,
// and the tree that routing reads from.
type Pool struct {
	sql   SQLPool
	store *Store
}

// SQLPool is the half of a storage backend this package does not replace. It
// is satisfied by the sqlite pool, and by the others — nothing here is
// sqlite-specific — though a filesystem configuration tree is a single-node
// deployment's idea, which is the same deployment that runs sqlite.
type SQLPool interface {
	database.Pool
	service.Pool
}

// NewPool wraps sql so the configuration kinds read from store.
func NewPool(sql SQLPool, store *Store) *Pool {
	return &Pool{sql: sql, store: store}
}

// Store reports the configuration tree this pool serves, for diagnostics.
func (p *Pool) Store() *Store { return p.store }

// SQL reports the wrapped pool. A caller that needs the SQL backend itself —
// a test fixture staging a row, a dialect-specific maintenance helper — has to
// reach past the decorator, because those helpers type-assert to their own
// pool and this one is not it.
func (p *Pool) SQL() SQLPool { return p.sql }

// Statements implements [service.Statementer].
func (p *Pool) Statements() service.AllStatements {
	return NewStatements(p.sql.Statements(), p.store)
}

// Transaction implements [service.Transactioner].
//
// The transaction is the SQL one: a file write cannot join it, and pretending
// otherwise by buffering writes until commit would only move the failure. What
// this does guarantee is that the SQL half of a configuration write — the audit
// event, the resource-scope row — is still atomic with the rest of the
// transaction it runs in, and that a rollback leaves those rows untouched.
//
// A configuration write that lands on disk and then loses its transaction
// leaves the file ahead of the database. The tree is the source of truth for
// content, so the next read serves the file and the scope row is rebuilt by the
// next write; an operator who cares can re-run the CLI. This is the cost of
// holding configuration outside the database, and it is why the trade is worth
// making only for the resources a person edits by hand.
func (p *Pool) Transaction(ctx context.Context, fn func(ctx context.Context, tx service.Statementer[service.AllStatements]) error) error {
	return p.sql.Transaction(ctx, func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
		return fn(ctx, statementer{stmts: NewStatements(tx.Statements(), p.store)})
	})
}

// Close stops watching the tree and closes the SQL pool.
func (p *Pool) Close(ctx context.Context) error {
	if err := p.store.Close(); err != nil {
		return err
	}
	return p.sql.Close(ctx)
}

// Ping implements [database.Pool]. The tree needs no liveness check of its own:
// a read either finds files or does not, and a missing directory is a valid
// empty configuration.
func (p *Pool) Ping(ctx context.Context) error { return p.sql.Ping(ctx) }

// Migrate implements [database.Pool]. The configuration kinds have no schema to
// migrate; the SQL half still does, including the tables the configuration
// kinds keep writing to (resource_scope_index, events).
func (p *Pool) Migrate(ctx context.Context) error { return p.sql.Migrate(ctx) }

// statementer hands the composed statements to a transaction callback.
type statementer struct{ stmts service.AllStatements }

func (s statementer) Statements() service.AllStatements { return s.stmts }

var (
	_ database.Pool = (*Pool)(nil)
	_ service.Pool  = (*Pool)(nil)
)
