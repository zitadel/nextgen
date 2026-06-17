package spanner

import (
	"context"

	storagedb "github.com/zitadel/nextgen/internal/storage/database"
	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
)

// Dialect connects through the v1 Spanner connector configuration.
type Dialect struct {
	Connector storagedb.Connector
}

// Connect implements [v2database.Dialect].
func (d Dialect) Connect(ctx context.Context) (v2database.Pool, error) {
	pool, err := d.Connector.Connect(ctx)
	if err != nil {
		return nil, err
	}
	return WrapPool(pool), nil
}

// Name implements [v2database.Dialect].
func (d Dialect) Name() string {
	return "spanner"
}

var _ v2database.Dialect = (*Dialect)(nil)
