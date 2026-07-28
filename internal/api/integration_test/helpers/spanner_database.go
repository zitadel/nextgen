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

	if h.DBPool == nil {
		var err error
		h.DBPool, err = Connector.Connect(t.Context())
		require.NoError(t, err)
	}
	return h.DBPool
}

func (h *Harness) EnsureServiceDB(t *testing.T) *service.DB {
	t.Helper()

	if h.DB == nil {
		cfg, ok := Connector.(*spannerdialect.Config)
		require.True(t, ok)
		dialect, err := spannerv2.DecodeConfig(cfg.DSN)
		require.NoError(t, err)
		pool, err := dialect.Connect(t.Context())
		require.NoError(t, err)
		h.DB = service.NewPool(pool.(service.Pool))
	}
	return h.DB
}
