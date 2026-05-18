package server

import (
	"github.com/zitadel/nextgen/internal/storage/database"
)

type Config struct {
	Server   ServerConfig    `mapstructure:"server"`
	Database database.Config `mapstructure:"database"`
}

type ServerConfig struct {
	Address string `mapstructure:"address"`
}
