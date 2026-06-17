package sql

import "github.com/zitadel/nextgen/internal/storage/v2/database"

type Dialect interface {
	database.Dialect
}
