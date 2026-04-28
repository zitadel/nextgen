package embedded

import (
	"context"

	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
)

type Pool struct {
	*postgres.Pool
	stop func()
}

// Connect implements [database.Connector].
func (e *Pool) Connect(ctx context.Context) (database.Pool, error) {
	connector, stop, err := StartEmbedded()
	if err != nil {
		return nil, err
	}
	pool, err := connector.Connect(ctx)
	if err != nil {
		return nil, err
	}
	return &Pool{Pool: pool.(*postgres.Pool), stop: stop}, nil
}

func (p *Pool) Close(ctx context.Context) error {
	if err := p.Pool.Close(ctx); err != nil {
		return err
	}
	p.stop()
	return nil
}
