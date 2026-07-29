//go:build !spanner_integration

package helpers

import (
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	pgold "github.com/zitadel/nextgen/internal/storage/database/dialect/postgres"
	"github.com/zitadel/nextgen/internal/storage/database/dialect/postgres/embedded"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/postgres"
)

var Connector database.Connector

func (h *Harness) EnsureDBPool(t *testing.T) database.Pool {
	t.Helper()
	h.dBPool.mutex.Lock()
	defer h.dBPool.mutex.Unlock()

	if h.dBPool.value == nil {
		var err error
		h.dBPool.value, err = Connector.Connect(t.Context())
		require.NoError(t, err)
	}
	return h.dBPool.value
}

func (h *Harness) EnsureServiceDB(t *testing.T) *service.DB {
	t.Helper()
	h.dB.mutex.Lock()
	defer h.dB.mutex.Unlock()

	if h.dB.value == nil {
		var pgxPool *pgxpool.Pool
		switch p := h.EnsureDBPool(t).(type) {
		case *embedded.Pool:
			pgxPool = p.Pool.Pool
		case *pgold.Pool:
			pgxPool = p.Pool
		}
		pool, err := (&postgres.PoolConfig{Pool: pgxPool}).Connect(t.Context())
		require.NoError(t, err)
		h.dB.value = service.NewPool(pool.(service.Pool))
	}
	return h.dB.value
}
