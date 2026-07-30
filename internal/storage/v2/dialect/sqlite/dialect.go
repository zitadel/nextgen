package sqlite

import (
	"context"
	"database/sql"

	_ "modernc.org/sqlite" // register "sqlite" driver

	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func init() {
	database.MustRegisterDialect("sqlite", DecodeConfig)
}

// Config holds the SQLite DSN (file path, :memory:, etc.).
type Config struct {
	DSN string
}

// Connect implements [database.Dialect].
func (c Config) Connect(ctx context.Context) (database.Pool, error) {
	sqlDB, err := sql.Open("sqlite", c.DSN)
	if err != nil {
		return nil, err
	}
	sqlDB.SetMaxOpenConns(1)
	if err := sqlDB.PingContext(ctx); err != nil {
		_ = sqlDB.Close()
		return nil, err
	}
	return newPool(sqlDB), nil
}

// Name implements [database.Dialect].
func (c Config) Name() string {
	return "sqlite"
}

var _ database.Dialect = Config{}

// DecodeConfig parses a SQLite DSN string.
func DecodeConfig(input any) (database.Dialect, error) {
	switch v := input.(type) {
	case string:
		return Config{DSN: v}, nil
	default:
		return nil, database.ErrInvalidDialectConfig(input)
	}
}
