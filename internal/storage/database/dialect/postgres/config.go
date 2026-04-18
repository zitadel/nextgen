package postgres

import (
	"context"
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mitchellh/mapstructure"

	"github.com/zitadel/nextgen/internal/storage/database"
)

var (
	_          database.Connector = (*Config)(nil)
	Name                          = "postgres"
	isMigrated bool
)

const (
	connectRetryAttempts = 5
	connectRetryDelay    = 200 * time.Millisecond
	connectRetryTimeout  = 5 * time.Second
)

type Config struct {
	*pgxpool.Config
	*pgxpool.Pool

	// Host               string
	// Port               int32
	// Database           string
	// MaxOpenConns       uint32
	// MaxIdleConns       uint32
	// MaxConnLifetime    time.Duration
	// MaxConnIdleTime    time.Duration
	// User               User
	// // Additional options to be appended as options=<Options>
	// // The value will be taken as is. Multiple options are space separated.
	// Options string

	// configuredFields []string
}

// Connect implements [database.Connector].
func (c *Config) Connect(ctx context.Context) (database.Pool, error) {
	pool, err := c.getPool(ctx)
	if err != nil {
		return nil, wrapError(err)
	}
	if err = retry(ctx, connectRetryAttempts, connectRetryDelay, func(ctx context.Context) error {
		pingCtx, cancel := context.WithTimeout(ctx, connectRetryTimeout)
		defer cancel()
		return pool.Ping(pingCtx)
	}); err != nil {
		pool.Close()
		return nil, wrapError(err)
	}
	return &pgxPool{Pool: pool}, nil
}

func (c *Config) getPool(ctx context.Context) (*pgxpool.Pool, error) {
	if c.Pool != nil {
		return c.Pool, nil
	}
	return pgxpool.NewWithConfig(ctx, c.Config)
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

func retry(ctx context.Context, attempts int, delay time.Duration, operation func(ctx context.Context) error) error {
	if attempts < 1 {
		attempts = 1
	}

	var err error
	for i := 0; i < attempts; i++ {
		if err = ctx.Err(); err != nil {
			return err
		}

		if err = operation(ctx); err == nil {
			return nil
		}

		if i == attempts-1 {
			break
		}

		if err = func(ctx context.Context) error {
			timer := time.NewTimer(delay)
			defer timer.Stop()
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-timer.C:
				return nil
			}
		}(ctx); err != nil {
			return err
		}
	}
	return err
}
