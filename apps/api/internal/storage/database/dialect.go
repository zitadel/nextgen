package database

import (
	"context"
	"log/slog"
	"maps"
	"slices"
	"sync"
)

func Connect(ctx context.Context, dialect Dialect) (Pool, error) {
	pool, err := dialect.Connect(ctx)
	if err != nil {
		return nil, err
	}
	return pool, nil
}

// Dialect is a database dialect. e.g. postgres, mysql, sqlite.
type Dialect interface {
	// Name returns the name of the dialect. e.g. "postgres", "mysql", "sqlite".
	Name() string
	// Connect creates a new connection pool for the dialect.
	// The returned pool should be ready to use and connected to the database.
	Connect(ctx context.Context) (Pool, error)
}

type DialectDecoder func(value any) (Dialect, error)

var (
	dialectRegistryMu sync.RWMutex
	dialectRegistry   = make(map[string]DialectDecoder)
	defaultDialect    Dialect
)

func RegisterDialect(name string, decoder DialectDecoder) error {
	dialectRegistryMu.Lock()
	defer dialectRegistryMu.Unlock()
	if _, exists := dialectRegistry[name]; exists {
		return ErrDialectAlreadyRegistered(name)
	}
	dialectRegistry[name] = decoder
	return nil
}

func MustRegisterDialect(name string, decoder DialectDecoder) {
	err := RegisterDialect(name, decoder)
	if err != nil {
		panic(err)
	}
}

func MustRegisterDefaultDialect(dialect Dialect) {
	if dialect == nil {
		panic("database: default dialect is nil")
	}
	defaultDialect = dialect
}

type Config struct {
	Raw map[string]any `mapstructure:",remain" yaml:",inline"`
}

// Build resolves the configured dialect and returns its connector.
func (c Config) Build() (Dialect, error) {
	return c.build(snapshotDialects())
}

func (c Config) build(decoders map[string]DialectDecoder) (Dialect, error) {
	if len(c.Raw) == 0 {
		if defaultDialect != nil {
			slog.Info("no database dialect configured, fallback to default dialect")
			return defaultDialect, nil
		}
		return nil, ErrNoDialectConfigured()
	}
	if len(c.Raw) != 1 {
		keys := slices.Collect(maps.Keys(c.Raw))
		slices.Sort(keys)
		return nil, ErrMultipleDialectsConfigured(len(c.Raw), keys)
	}

	for name, raw := range c.Raw {
		decoder, ok := decoders[name]
		if !ok {
			return nil, ErrUnsupportedDialect(name)
		}
		connector, err := decoder(raw)
		if err != nil {
			return nil, ErrDecodeDialect(name, err)
		}
		return connector, nil
	}

	return nil, ErrNoDialectConfigured()
}

func snapshotDialects() map[string]DialectDecoder {
	dialectRegistryMu.RLock()
	defer dialectRegistryMu.RUnlock()

	out := make(map[string]DialectDecoder, len(dialectRegistry))
	maps.Copy(out, dialectRegistry)
	return out
}

func DialectKeysForEnv() []string {
	dialectRegistryMu.RLock()
	defer dialectRegistryMu.RUnlock()

	keys := maps.Keys(dialectRegistry)
	return slices.Collect(keys)
}
