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

type Config[T database.TypedTransaction] struct {
	*pgxpool.Config
}

// Connect implements [database.Dialect].
func (p Config[T]) Connect(ctx context.Context) (database.Pool, error) {
	pool, err := pgxpool.NewWithConfig(ctx, p.Config)
	if err != nil {
		return nil, err
	}
	return newPool(pool), nil
}

// Name implements [database.Dialect].
func (p Config[T]) Name() string {
	return "postgres"
}

var _ database.Dialect = (*Config[database.TypedTransaction])(nil)

func DecodeConfig(input any) (database.Dialect, error) {
	switch c := input.(type) {
	case string:
		config, err := pgxpool.ParseConfig(c)
		if err != nil {
			return nil, err
		}
		return &Config[database.TypedTransaction]{Config: config}, nil
	case map[string]any:
		connector := new(Config[database.TypedTransaction])
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
