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
}
