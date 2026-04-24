package spanner

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"cloud.google.com/go/spanner"
	"github.com/zitadel/nextgen/internal/storage/database"
)

var (
	_    database.Connector = (*Config)(nil)
	Name                    = "spanner"
)

func init() {
	database.MustRegisterDialect(Name, DecodeConfig)
}

type Config struct {
	Database string
	// We start simple and only support the database path, but we can add more configuration options here in the future if needed.
	// See [sp.ClientConfig] for possible options.
}

func DecodeConfig(input any) (database.Connector, error) {
	dsn, ok := input.(string)
	if !ok {
		return nil, errors.New("invalid configuration")
	}
	dsn = strings.TrimSpace(dsn)
	if dsn == "" {
		return nil, errors.New("invalid configuration")
	}
	if !strings.HasPrefix(dsn, "projects/") {
		return nil, fmt.Errorf("invalid spanner database path %q", dsn)
	}
	return &Config{Database: dsn}, nil
}

// Connect implements [database.Connector].
func (c *Config) Connect(ctx context.Context) (database.Pool, error) {
	_, err := spanner.NewClient(ctx, c.Database)
	if err != nil {
		return nil, fmt.Errorf("spanner: failed to create client: %w", err)
	}
	return nil, errors.New("spanner: not implemented")
}
