//go:build !spanner_integration

package helpers

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres/embedded"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/postgres"
)

var Connector database.Connector

func (h *Harness) EnsureDBPool(t *testing.T) database.Pool {
	t.Helper()

	if h.DBPool == nil {
		var err error
		h.DBPool, err = Connector.Connect(t.Context())
		require.NoError(t, err)
	}
	return h.DBPool
}

func (h *Harness) ServiceDB(t *testing.T) *service.DB {
	t.Helper()

	if h.DB == nil {
		pool, err := (&postgres.PoolConfig{Pool: h.EnsureDBPool(t).(*embedded.Pool).Pool.Pool}).Connect(t.Context())
		require.NoError(t, err)
		h.DB = service.NewPool(pool.(service.Pool))
	}
	return h.DB
}
