package spanner

import (
	"context"

	"cloud.google.com/go/spanner"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

type Dialect struct {
	// Database is the Spanner database string, in the format "projects/{project}/instances/{instance}/databases/{database}".
	Database string
}

// Connect implements [database.Dialect].
func (d *Dialect) Connect(ctx context.Context) (database.Pool, error) {
	client, err := spanner.NewClient(ctx, d.Database)
	if err != nil {
		return nil, err
	}
	return newClient(client), nil
}

// Name implements [database.Dialect].
func (d *Dialect) Name() string {
	return "spanner"
}

var _ database.Dialect = (*Dialect)(nil)
