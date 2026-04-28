package server

import (
	"github.com/zitadel/nextgen/internal/storage/database"
)

type Config struct {
	Database database.Config `mapstructure:"database"`
}
