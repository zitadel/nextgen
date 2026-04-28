package server

import (
	"fmt"

	"github.com/zitadel/nextgen/internal/storage/database"
)

type Config struct {
	Database database.Config `mapstructure:"database"`
	Port     int             `mapstructure:"port"`
}

func (c Config) ListenAddr() string {
	port := c.Port
	if port == 0 {
		port = 8080
	}
	return fmt.Sprintf(":%d", port)
}
