package database

import (
	"context"
)

type Dialect interface {
	// Name returns the name of the dialect. e.g. "postgres", "mysql", "sqlite".
	Name() string
	// Connect creates a new connection pool for the dialect.
	// The returned pool should be ready to use and connected to the database.
	Connect(ctx context.Context) (Pool, error)
}
