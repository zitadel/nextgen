package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

type Config struct {
	DSN string
}

// Connect implements [database.Dialect].
func (p Config) Connect(ctx context.Context) (database.Pool, error) {
	config, err := pgxpool.ParseConfig(p.DSN)
	if err != nil {
		return nil, err
	}
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, err
	}
	return NewPool(pool), nil
}

// Name implements [database.Dialect].
func (p Config) Name() string {
	return "postgres"
}

var _ database.Dialect = (*Config)(nil)
