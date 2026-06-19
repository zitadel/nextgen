package database

import (
	"context"
)

func PoolAs[T TypedTransaction](pool Pool) T {
	var zero T
	if _, ok := any(zero).(Transactional); ok {
		return any(pool).(T)
	}
	return any(&typedPool[T]{Pool: pool}).(T)
}

type typedPool[T TypedTransaction] struct {
	Pool
}

func (p *typedPool[T]) Transaction(ctx context.Context, fn func(context.Context, T) error) error {
	return p.Pool.Transaction(ctx, func(ctx context.Context, tx Transaction) error {
		return fn(ctx, tx.(T))
	})
}

// Pool is a connection pool. e.g. pgxpool
type Pool interface {
	Transactional

	Close(ctx context.Context) error

	Ping(ctx context.Context) error
}

type Transactional interface {
	Transaction(ctx context.Context, fn func(context.Context, Transaction) error) error
}

type TypedTransactional[T TypedTransaction] interface {
	Transaction(ctx context.Context, fn func(context.Context, T) error) error
}

func TransactionAs[T TypedTransaction](tx Transaction) T {
	return tx.(T)
}

type TypedTransaction interface {
	Transaction | interface{ Transaction }
}

type Transaction any

type Execution interface {
	Execute(ctx context.Context) error
}

type Query[R any] interface {
	Execution
	Result() R
}
