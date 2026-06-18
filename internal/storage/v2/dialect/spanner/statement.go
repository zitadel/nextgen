package spanner

import (
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

type queryExecutor interface {
}

type statements struct {
	client queryExecutor
}

var _ database.Statementer = (*statements)(nil)
