package spanner

import (
	"context"
	"database/sql"
	"errors"

	"github.com/zitadel/nextgen/internal/storage/database"
)

var (
	_    database.Connector = (*Config)(nil)
	Name                    = "spanner"
)

// Config holds connection settings for a Spanner database accessed via the
// go-sql-spanner driver (GoogleSQL dialect).
// DSN format: projects/<project>/instances/<instance>/databases/<database>
type Config struct {
	DSN string
}

func (c *Config) Connect(ctx context.Context) (database.Pool, error) {
	db, err := sql.Open("spanner", c.DSN)
	if err != nil {
		return nil, wrapError(err)
	}
	pool := &spannerPool{db: db}
	if err = pool.Ping(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return pool, nil
}

// DecodeConfig parses a Spanner DSN string.
// Expected format: projects/<project>/instances/<instance>/databases/<database>
func DecodeConfig(input any) (database.Connector, error) {
	dsn, ok := input.(string)
	if !ok {
		return nil, errors.New("invalid configuration: expected DSN string")
	}
	return &Config{DSN: dsn}, nil
}
