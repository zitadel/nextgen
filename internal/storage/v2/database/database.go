package database

import (
	"context"
)

type Pool interface {
	Close(ctx context.Context) error
	Ping(ctx context.Context) error
}

type Execution interface {
	Execute(ctx context.Context) error
}

type Query[R any] interface {
	Query(ctx context.Context) (*R, error)
}
