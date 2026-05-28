package server

import (
	"time"

	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type Config struct {
	Server         ServerConfig          `mapstructure:"server"`
	Database       database.Config       `mapstructure:"database"`
	PasswordHasher crypto.HashConfig     `mapstructure:"password_hasher"`
	Schema         SchemaConfig          `mapstructure:"schema"`
	Session        service.SessionConfig `mapstructure:"session"`
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
	// CookieSealerKey is the 32-byte (hex-encoded, 64 chars) symmetric
	// key used to seal flow cookies. Required — the server refuses to
	// boot without it. Bind via NEXTGEN_SERVER_COOKIE_SEALER_KEY.
	CookieSealerKey string `mapstructure:"cookie_sealer_key"`
}

type SchemaConfig struct {
	BuiltinPublicBase string `mapstructure:"builtin_public_base"`
	LRUCacheSize      int    `mapstructure:"lru_cache_size"`
}
