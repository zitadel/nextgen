package server

import (
	"time"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/instrumentation"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

const Name = "zitadel/backend/v3/instrumentation/tracing"

type Config struct {
	Server          ServerConfig           `mapstructure:"server"`
	Database        database.Config        `mapstructure:"database"`
	PasswordHasher  crypto.HashConfig      `mapstructure:"password_hasher"`
	Schema          SchemaConfig           `mapstructure:"schema"`
	Session         service.SessionConfig  `mapstructure:"session"`
	Instrumentation instrumentation.Config `mapstructure:"instrumentation"`
}

func (c Config) Validate() error {
	for _, validate := range []func() error{
		c.Session.Validate,
	} {
		if err := validate(); err != nil {
			return err
		}
	}
	return nil
}

type SessionConfig struct {
	DefaultTTL time.Duration `mapstructure:"default_ttl"`
	MaxTTL     time.Duration `mapstructure:"max_ttl"`
}

type ServerConfig struct {
	Address string `mapstructure:"address"`
	// DataDir is the local runtime root used by zero-config server defaults.
	// When unset, it defaults to a nextgen-data directory next to the binary.
	DataDir string `mapstructure:"data_dir"`
	// EncryptionKey is the 32-byte (hex-encoded, 64 chars) symmetric
	// key used to seal flow cookies. If unset, the server creates or reuses
	// EncryptionKeyFile.
	EncryptionKey string `mapstructure:"encryption_key"`
	// EncryptionKeyFile stores the generated encryption key for zero-config
	// local starts. When unset, it defaults under DataDir.
	EncryptionKeyFile string `mapstructure:"encryption_key_file"`

	ConsoleEnabled bool   `mapstructure:"console_enabled"`
	ConsolePath    string `mapstructure:"console_path"`
	LoginEnabled   bool   `mapstructure:"login_enabled"`
	LoginPath      string `mapstructure:"login_path"`
}

type SchemaConfig struct {
	BuiltinPublicBase string `mapstructure:"builtin_public_base"`
	LRUCacheSize      int    `mapstructure:"lru_cache_size"`
}
