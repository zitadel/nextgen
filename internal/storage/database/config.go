package database

import (
	"context"
	"errors"
	"fmt"
	"log"
	"maps"
	"slices"
	"sync"
)

// Connector abstracts the database driver.
type Connector interface {
	Connect(ctx context.Context) (Pool, error)
}

// DialectDecoder decodes a raw configuration value into a database connector.
type DialectDecoder func(value any) (Connector, error)

var (
	dialectRegistryMu sync.RWMutex
	dialectRegistry   = make(map[string]DialectDecoder)
	defaultConnector  Connector
)

// RegisterDialect registers a decoder under a dialect name.
func RegisterDialect(name string, decoder DialectDecoder) error {
	if name == "" {
		return errors.New("database: dialect name is required")
	}
	if decoder == nil {
		return fmt.Errorf("database: decoder for %q is nil", name)
	}

	dialectRegistryMu.Lock()
	defer dialectRegistryMu.Unlock()
	dialectRegistry[name] = decoder
	return nil
}

// MustRegisterDialect is like RegisterDialect but panics on error.
func MustRegisterDialect(name string, decoder DialectDecoder) {
	err := RegisterDialect(name, decoder)
	if err != nil {
		panic(err)
	}
}

// MustRegisterDefaultConnector registers a default connector that is used when no dialect is configured. It panics on error.
func MustRegisterDefaultConnector(connector Connector) {
	if connector == nil {
		panic("database: default connector is nil")
	}
	defaultConnector = connector
}

// Config contains one configured database dialect.
//
// Example:
//
//	database:
//	  postgres: postgres://user:pass@host:5432/db
//
// or
//
//	database:
//	  spanner: projects/my-project/instances/my-instance/databases/my-database
//
// We might need to document how or where the client gets the authentication credentials for spanner, but for now we can assume that the application is running in an environment where the default credentials work (e.g. GCE, GKE, Cloud Run, etc.).
// It might be possible that we want to add more fields later, see https://pkg.go.dev/cloud.google.com/go/spanner@v1.91.0#ClientConfig.
// In that case the config might look like this:
//
//	database:
//	  spanner:
//	    database: projects/my-project/instances/my-instance/databases/my-database
//	    option1: value1
//	    option2: value2
//
// The configured dialect key/value is captured in Raw.
type Config struct {
	Raw map[string]any `mapstructure:",remain" yaml:",inline"`
}

// Build resolves the configured dialect and returns its connector.
func (c Config) Build() (Connector, error) {
	return c.build(snapshotDialects())
}

func (c Config) build(decoders map[string]DialectDecoder) (Connector, error) {
	if len(c.Raw) == 0 {
		if defaultConnector != nil {
			log.Println("no database dialect configured, fallback to default connector")
			return defaultConnector, nil
		}
		return nil, fmt.Errorf("database: no dialect configured")
	}
	if len(c.Raw) != 1 {
		keys := slices.Collect(maps.Keys(c.Raw))
		slices.Sort(keys)
		return nil, fmt.Errorf("database: expected exactly one dialect, got %d (%v)", len(c.Raw), keys)
	}

	for name, raw := range c.Raw {
		decoder, ok := decoders[name]
		if !ok {
			return nil, fmt.Errorf("database: unsupported dialect %q", name)
		}
		connector, err := decoder(raw)
		if err != nil {
			return nil, fmt.Errorf("database: decode %q: %w", name, err)
		}
		return connector, nil
	}

	return nil, fmt.Errorf("database: no dialect configured")
}

func snapshotDialects() map[string]DialectDecoder {
	dialectRegistryMu.RLock()
	defer dialectRegistryMu.RUnlock()

	out := make(map[string]DialectDecoder, len(dialectRegistry))
	maps.Copy(out, dialectRegistry)
	return out
}
