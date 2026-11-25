package postgres

import (
	"context"
	"time"

	"github.com/go-viper/mapstructure/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/zitadel/nextgen/internal/storage/database"
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
	if p.ConnConfig.Tracer == nil {
		p.ConnConfig.Tracer = pgxTracer{}
	}
	p.AfterConnect = scanTimestamptzUTC(p.AfterConnect)
	pgxPool, err := pgxpool.NewWithConfig(ctx, p.Config)
	if err != nil {
		return nil, err
	}
	return newPool(pgxPool), nil
}

// scanTimestamptzUTC makes timestamptz scan as UTC, then runs next. pgx would
// otherwise scan it into the process's local zone, while the API contract is
// RFC3339 UTC (docs/design/api/conventions.md). It wraps rather than replaces
// next so that adding a hook cannot silently drop the scan location.
func scanTimestamptzUTC(next func(context.Context, *pgx.Conn) error) func(context.Context, *pgx.Conn) error {
	return func(ctx context.Context, conn *pgx.Conn) error {
		conn.TypeMap().RegisterType(&pgtype.Type{
			Name:  "timestamptz",
			OID:   pgtype.TimestamptzOID,
			Codec: &pgtype.TimestamptzCodec{ScanLocation: time.UTC},
		})
		if next == nil {
			return nil
		}
		return next(ctx, conn)
	}
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
		connMap := c
		if nested, ok := c["ConnConfig"].(map[string]any); ok {
			connMap = nested
		}

		pgconnConfig := &pgconn.Config{}
		decoder, err := mapstructure.NewDecoder(&mapstructure.DecoderConfig{
			DecodeHook:       mapstructure.StringToTimeDurationHookFunc(),
			WeaklyTypedInput: true,
			Result:           pgconnConfig,
		})
		if err != nil {
			return nil, err
		}
		if err = decoder.Decode(connMap); err != nil {
			return nil, err
		}

		return &Config{
			Config: &pgxpool.Config{
				ConnConfig: &pgx.ConnConfig{
					Config: *pgconnConfig,
				},
			},
		}, nil
	}
	return nil, database.ErrInvalidDialectConfig(input)
}
