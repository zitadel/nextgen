//go:build spanner_integration

package helpers

import (
	"testing"

	"github.com/stretchr/testify/require"
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
