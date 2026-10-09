package spanner

import (
	"context"

	"cloud.google.com/go/spanner"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func init() {
	database.MustRegisterDialect("spanner", DecodeConfig)
}

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
	return newClient(d.Database, client), nil
}

// Name implements [database.Dialect].
func (d *Dialect) Name() string {
	return "spanner"
}

var _ database.Dialect = (*Dialect)(nil)

// DecodeConfig parses a Spanner database DSN string.
// Expected format: projects/<project>/instances/<instance>/databases/<database>
func DecodeConfig(input any) (database.Dialect, error) {
	dsn, ok := input.(string)
	if !ok {
		return nil, database.ErrInvalidDialectConfig(input)
	}
	return &Dialect{Database: dsn}, nil
}
