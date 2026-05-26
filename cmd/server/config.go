package server

import (
	"github.com/zitadel/nextgen/internal/crypto"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type Config struct {
	Server         ServerConfig      `mapstructure:"server"`
	Database       database.Config   `mapstructure:"database"`
	PasswordHasher crypto.HashConfig `mapstructure:"password_hasher"`
}

type ServerConfig struct {
	Address string `mapstructure:"address"`
	// CookieSealerKey is the 32-byte (hex-encoded, 64 chars) symmetric
	// key used to seal flow cookies. Required — the server refuses to
	// boot without it. Bind via NEXTGEN_SERVER_COOKIE_SEALER_KEY.
	CookieSealerKey string `mapstructure:"cookie_sealer_key"`
}
