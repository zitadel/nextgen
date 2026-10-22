// Package dbtest provides shared bring-up of databases for v2 storage
// integration test suites.
//
// Helpers return already-connected v2 pools with migrations applied (via the
// v2 pool's Migrate API).
package dbtest

import (
	"fmt"

	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// Pool is a migrated v2 pool usable for both storage lifecycle and statements.
type Pool interface {
	database.Pool
	service.Pool
}

func asPool(pool database.Pool) (Pool, error) {
	p, ok := pool.(Pool)
	if !ok {
		return nil, fmt.Errorf("dbtest: pool %T does not implement dbtest.Pool", pool)
	}
	return p, nil
}
