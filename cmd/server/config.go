package server

import (
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type Config struct {
	Server         ServerConfig      `mapstructure:"server"`
	Database       database.Config   `mapstructure:"database"`
	PasswordHasher crypto.HashConfig `mapstructure:"password_hasher"`
	Schema   SchemaConfig    `mapstructure:"schema"`
}

type ServerConfig struct {
	Address string `mapstructure:"address"`
}

type SchemaConfig struct {
	BuiltinPublicBase string `mapstructure:"builtin_public_base"`
	LRUCacheSize      int    `mapstructure:"lru_cache_size"`
}
