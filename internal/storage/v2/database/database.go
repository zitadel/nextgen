package database

import (
	"context"
)

type ServicePool[T TypedTransaction] struct {
	TypedPool[T]
	p Pool
}

func (sp ServicePool[T]) Transaction(ctx context.Context, fn func(context.Context, T) error) error {
	return sp.p.Transaction(ctx, func(ctx context.Context, tx Transaction) error {
		return fn(ctx, TransactionAs[T](tx))
	})
}

func AsServicePool[SP interface{ TypedPool[T] }, T TypedTransaction](pool Pool) SP {
	var zero SP
	sp := ServicePool[T]{p: pool, TypedPool: zero}
	return any(sp).(SP)
}

// func PoolAs[
// 	PAfter TypedPool[TAfter],
// 	TAfter, TBefore TypedTransaction,
// ](pool TypedPool[TBefore]) PAfter {
// 	var (
// 		zero  TAfter
// 		zeroP PAfter
// 	)
// 	return any(wrapper[TAfter, TBefore]{
// 		before:           pool,
// 		TypedTransaction: zero,
// 		TypedPool:        zeroP,
// 	}).(PAfter)
// }

// type wrapper[TAfter, TBefore TypedTransaction] struct {
// 	TypedTransaction
// 	before TypedPool[TBefore]
// 	TypedPool[TAfter]
// }

// func (w wrapper[TAfter, TBefore]) Transaction(ctx context.Context, fn func(context.Context, TAfter) error) error {
// 	return w.before.Transaction(ctx, func(ctx context.Context, tx TBefore) error {
// 		return fn(ctx, any(tx).(TAfter))
// 	})
// }

// Pool is a connection pool. e.g. pgxpool
type Pool interface {
	TypedPool[Transaction]
}

type TypedPool[T TypedTransaction] interface {
	Transaction(ctx context.Context, fn func(context.Context, T) error) error

	Close(ctx context.Context) error
	Ping(ctx context.Context) error
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
	Result() *R
}
