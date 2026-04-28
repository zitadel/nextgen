package spanner

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/zitadel/nextgen/internal/storage/database"
)

var (
	_          database.Connector = (*Config)(nil)
	Name                          = "spanner"
	isMigrated bool
)

// Config holds connection settings for a Spanner database accessed via PGAdapter,
// which exposes the Spanner PostgreSQL dialect over the PostgreSQL wire protocol.
type Config struct {
	*pgxpool.Config
	*pgxpool.Pool
}

func (c *Config) Connect(ctx context.Context) (database.Pool, error) {
	pool, err := c.getPool(ctx)
	if err != nil {
		return nil, wrapError(err)
	}
	if err = pool.Ping(ctx); err != nil {
		return nil, wrapError(err)
	}
	return &pgxPool{Pool: pool}, nil
}

func (c *Config) getPool(ctx context.Context) (*pgxpool.Pool, error) {
	if c.Pool != nil {
		return c.Pool, nil
	}
	return pgxpool.NewWithConfig(ctx, c.Config)
}

// DecodeConfig parses a PostgreSQL connection URL for a PGAdapter endpoint.
// The database name must be a Spanner resource path, e.g.
// projects/my-project/instances/my-instance/databases/my-db.
func DecodeConfig(input any) (database.Connector, error) {
	switch c := input.(type) {
	case string:
		config, err := pgxpool.ParseConfig(c)
		if err != nil {
			return nil, err
		}
		return &Config{Config: config}, nil
	}
	return nil, errors.New("invalid configuration: expected connection URL string")
}
