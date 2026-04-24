package postgres

import (
	"context"
	"errors"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mitchellh/mapstructure"

	"github.com/zitadel/nextgen/internal/storage/database"
)

var (
	_          database.Connector = (*Config)(nil)
	Name                          = "postgres"
	isMigrated bool
)

func init() {
	database.MustRegisterDialect(Name, DecodeConfig)
	database.MustRegisterDialect("pg", DecodeConfig)
}

type Config struct {
	*pgxpool.Config
}

// Connect implements [database.Connector].
func (c *Config) Connect(ctx context.Context) (database.Pool, error) {
	pool, err := pgxpool.NewWithConfig(ctx, c.Config)
	if err != nil {
		return nil, wrapError(err)
	}
	if err = pool.Ping(ctx); err != nil {
		return nil, wrapError(err)
	}
	return &pgxPool{Pool: pool}, nil
}

func NameMatcher(name string) bool {
	return slices.Contains([]string{"postgres", "pg"}, strings.ToLower(name))
}

func DecodeConfig(input any) (database.Connector, error) {
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
