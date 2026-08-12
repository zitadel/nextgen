package service

import (
	"context"
)

type Pool interface {
	Transactioner[AllStatements]
	Statementer[AllStatements]
}

type Statementer[S any] interface {
	Statements() S
}

type Transactioner[S any] interface {
	Transaction(ctx context.Context, fn func(ctx context.Context, tx Statementer[S]) error) error
}

func NewPool(pool Pool) *DB {
	return &DB{
		pool: pool,
	}
}

type DB struct {
	pool Pool
}

func (p *DB) Transaction(ctx context.Context, callback func(ctx context.Context, tx Statementer[AllStatements]) error) error {
	return p.pool.Transaction(ctx, callback)
}

// Statements implements [Pool].
func (p *DB) Statements() AllStatements {
	return p.pool.Statements()
}

var _ Pool = (*DB)(nil)

// TODO(adlerhurst): the code below is prepared for go 1.27
// it then replaces [abstractPool.Transaction] and [abstractPool.Statements] with generic versions
// Visit https://gotipplay.golang.org/p/nVKh1r65BJ- to see the generic version of [abstractPool.Transaction] and [abstractPool.Statements] in action.

// func (p *abstractPool) Transaction[S any](ctx context.Context, callback func(ctx context.Context, tx Statementer[S]) error) error {
// 	return ap.pool.Transaction(ctx, func(ctx context.Context, tx Statementer[Statements]) error {
// 		return callback(ctx, abstractStatementer[S]{tx})
// 	})
// }

// func (ap AbstractPool) Statements[S any]() S {
// 	return ap.pool.Statements().(S)
// }

// type abstractStatementer[S any] struct {
// 	Statementer[Statements]
// }

// func (as abstractStatementer[S]) Statements() S {
// 	return as.Statementer.Statements().(S)
// }

// func (ap AbstractPool) As[S any]() typedAbstractPool[S] { return typedAbstractPool[S]{ap} }

// type typedAbstractPool[S any] struct{ ap AbstractPool }

// func (tap typedAbstractPool[S]) Transaction(ctx context.Context, callback func(context.Context, Statementer[S]) error) error {
// 	return tap.ap.Transaction[S](ctx, callback)
// }

// func (tap typedAbstractPool[S]) Statements() S {
// 	return tap.ap.Statements[S]()
// }
