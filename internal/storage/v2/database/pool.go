package database

import (
	"context"
)

type Pool interface {
	Close(ctx context.Context) error
	Ping(ctx context.Context) error
}
