//go:build spanner_integration

package helpers

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
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

// ServiceDB satisfies the shared harness helpers (EnsureProjectService needs
// it to build the server), but storage v2 has no spanner statements yet
// (zitadel/nextgen#457), so every test that reaches it skips.
func (h *Harness) ServiceDB(t *testing.T) *service.DB {
	t.Helper()
	t.Skip("storage v2 has no spanner statements yet (zitadel/nextgen#457)")
	return nil
}
