package postgres

import (
	"context"
	"fmt"
	"maps"
	"strings"

	"github.com/go-viper/mapstructure/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/zitadel/nextgen/internal/storage/database"
	pgschema "github.com/zitadel/nextgen/internal/storage/dialect/postgres/schema"
)

func init() {
	database.MustRegisterDialect("postgres", DecodeConfig)
	database.MustRegisterDialect("pg", DecodeConfig)
}

type Config struct {
	*pgxpool.Config
	// Schema is the schema the pool reads and writes. DecodeConfig resolves
	// it from the `schema` key or the connection's search_path and falls
	// back to [pgschema.Default]; see resolveSchema.
	Schema string
}

// Connect implements [database.Dialect].
func (p Config) Connect(ctx context.Context) (database.Pool, error) {
	pool, err := pgxpool.NewWithConfig(ctx, p.Config)
	if err != nil {
		return nil, err
	}
	return newPool(pool, p.Schema), nil
}

// Name implements [database.Dialect].
func (p Config) Name() string {
	return "postgres"
}

type PoolConfig struct {
	*pgxpool.Pool
	// Schema is the schema the pool reads and writes; empty means the default.
	Schema string
}

// Connect implements [database.Dialect].
func (p *PoolConfig) Connect(ctx context.Context) (database.Pool, error) {
	return newPool(p.Pool, p.Schema), nil
}

// Name implements [database.Dialect].
func (p *PoolConfig) Name() string {
	return "postgres"
}

var _ database.Dialect = (*PoolConfig)(nil)

var _ database.Dialect = (*Config)(nil)

// schemaKey names the schema: as a key beside the map-form connection
// settings, or as a DSN parameter (`postgres://…/db?schema=pr_42`). It is
// consumed here and never sent to the server, so it works through
// connection poolers that reject unknown startup parameters.
const schemaKey = "schema"

// searchPathParam is the connection parameter a DSN can carry the schema in
// instead, for example `postgres://…/db?search_path=pr_42`. Unlike schemaKey
// it is a real server setting and travels in the startup packet.
const searchPathParam = "search_path"

func DecodeConfig(input any) (database.Dialect, error) {
	switch c := input.(type) {
	case string:
		config, err := pgxpool.ParseConfig(c)
		if err != nil {
			return nil, err
		}
		explicit := config.ConnConfig.RuntimeParams[schemaKey]
		delete(config.ConnConfig.RuntimeParams, schemaKey)
		schema, err := resolveSchema(explicit, config.ConnConfig)
		if err != nil {
			return nil, err
		}
		return &Config{Config: config, Schema: schema}, nil
	case map[string]any:
		connMap := maps.Clone(c)
		explicit, err := popSchemaKey(connMap)
		if err != nil {
			return nil, err
		}
		if nested, ok := connMap["ConnConfig"].(map[string]any); ok {
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

		connConfig := &pgx.ConnConfig{Config: *pgconnConfig}
		schema, err := resolveSchema(explicit, connConfig)
		if err != nil {
			return nil, err
		}
		return &Config{
			Config: &pgxpool.Config{ConnConfig: connConfig},
			Schema: schema,
		}, nil
	}
	return nil, database.ErrInvalidDialectConfig(input)
}

// popSchemaKey removes the schema key from the map form and returns its
// value, so the connection decoder only sees connection settings.
func popSchemaKey(connMap map[string]any) (string, error) {
	for key, raw := range connMap {
		if !strings.EqualFold(key, schemaKey) {
			continue
		}
		schema, ok := raw.(string)
		if !ok {
			return "", fmt.Errorf("postgres: %s must be a string, got %T", schemaKey, raw)
		}
		delete(connMap, key)
		return schema, nil
	}
	return "", nil
}

// resolveSchema picks the schema a connection works in: the explicit value
// when one is configured (the schema key or DSN parameter), else the first
// entry of the connection's search_path, else [pgschema.Default]. Every
// statement and migration qualifies its objects, so the schema never has to
// be on the search_path; when a search_path is configured anyway, public is
// appended to it unless listed, because the extensions the migrations rely
// on are shared by every schema of a database and live there.
func resolveSchema(explicit string, conn *pgx.ConnConfig) (string, error) {
	schema := explicit
	searchPath := conn.RuntimeParams[searchPathParam]
	if schema == "" {
		schema = pgschema.Default
		if searchPath != "" {
			first, _, _ := strings.Cut(searchPath, ",")
			schema = strings.TrimSpace(first)
		}
	}
	if err := pgschema.Validate(schema); err != nil {
		return "", err
	}
	if schema != pgschema.Default && searchPath != "" && !searchPathLists(searchPath, "public") {
		if conn.RuntimeParams == nil {
			conn.RuntimeParams = map[string]string{}
		}
		conn.RuntimeParams[searchPathParam] = searchPath + ", public"
	}
	return schema, nil
}

func searchPathLists(searchPath, schema string) bool {
	for entry := range strings.SplitSeq(searchPath, ",") {
		if strings.TrimSpace(entry) == schema {
			return true
		}
	}
	return false
}
