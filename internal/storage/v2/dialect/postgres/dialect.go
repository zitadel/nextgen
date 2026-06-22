package postgres

import (
	"context"
	"errors"

	"github.com/go-viper/mapstructure/v2"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func init() {
	database.MustRegisterDialect("postgres", DecodeConfig)
	database.MustRegisterDialect("pg", DecodeConfig)
}

type Config struct {
	*pgxpool.Config
}

// Connect implements [database.Dialect].
func (p Config) Connect(ctx context.Context) (database.Pool, error) {
	pool, err := pgxpool.NewWithConfig(ctx, p.Config)
	if err != nil {
		return nil, err
	}
	return newPool(pool), nil
}

// Name implements [database.Dialect].
func (p Config) Name() string {
	return "postgres"
}

type PoolConfig struct {
	*pgxpool.Pool
}

// Connect implements [database.Dialect].
func (p *PoolConfig) Connect(ctx context.Context) (database.Pool, error) {
	return newPool(p.Pool), nil
}

// Name implements [database.Dialect].
func (p *PoolConfig) Name() string {
	return "postgres"
}

var _ database.Dialect = (*PoolConfig)(nil)

var _ database.Dialect = (*Config)(nil)

func DecodeConfig(input any) (database.Dialect, error) {
	switch c := input.(type) {
	case string:
		config, err := pgxpool.ParseConfig(c)
		if err != nil {
			return nil, err
		}
		return &Config{Config: config}, nil
	case map[string]any:
		connector := new(Config)
		decoder, err := mapstructure.NewDecoder(&mapstructure.DecoderConfig{
			DecodeHook:       mapstructure.StringToTimeDurationHookFunc(),
			WeaklyTypedInput: true,
			Result:           connector,
		})
		if err != nil {
			return nil, err
		}
		if err = decoder.Decode(c); err != nil {
			return nil, err
		}
		return connector, nil
	}
	return nil, errors.New("invalid configuration")
}
