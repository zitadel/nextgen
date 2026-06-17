package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	v1postgres "github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
)

type Dialect struct {
	DSN string
}

// Connect implements [v2database.Dialect].
func (p Dialect) Connect(ctx context.Context) (v2database.Pool, error) {
	config, err := pgxpool.ParseConfig(p.DSN)
	if err != nil {
		return nil, err
	}
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, err
	}
	return WrapPool(v1postgres.PGxPool(pool)), nil
}

// Name implements [v2database.Dialect].
func (p Dialect) Name() string {
	return "postgres"
}

var _ v2database.Dialect = (*Dialect)(nil)
