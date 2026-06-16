package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

type Dialect struct {
	DSN string
}

// Connect implements [database.Dialect].
func (p *Dialect) Connect(ctx context.Context) (database.Pool, error) {
	config, err := pgxpool.ParseConfig(p.DSN)
	if err != nil {
		return nil, err
	}
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, err
	}
	return &Pool{pool: pool}, nil
}

// Name implements [database.Dialect].
func (p *Dialect) Name() string {
	return "postgres"
}

// Statements implements [database.Dialect].
func (p *Dialect) Statements() database.Statements {
	panic("unimplemented")
}

var _ database.Dialect = (*Dialect)(nil)
