//go:build spanner_integration

package helpers

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	spannerdialect "github.com/zitadel/nextgen/internal/storage/database/dialect/spanner"
	spannerv2 "github.com/zitadel/nextgen/internal/storage/v2/dialect/spanner"
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
		cfg, ok := Connector.(*spannerdialect.Config)
		require.True(t, ok)
		dialect, err := spannerv2.DecodeConfig(cfg.DSN)
		require.NoError(t, err)
		pool, err := dialect.Connect(t.Context())
		require.NoError(t, err)
		h.dB.value = service.NewPool(pool.(service.Pool))
	}
	return h.dB.value
}
