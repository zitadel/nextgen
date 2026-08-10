package database

import (
	"context"
)

type Pool interface {
	Close(ctx context.Context) error
	Ping(ctx context.Context) error
	// Migrate applies all pending database migrations. It is expected to be
	// safe to call concurrently: implementations should serialize migration
	// execution and run it once per process (and/or per database).
	Migrate(ctx context.Context) error
}
