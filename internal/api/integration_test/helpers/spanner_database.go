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

	h.mu.Lock()
	pool := h.DBPool
	h.mu.Unlock()
	if pool != nil {
		return pool
	}
	pool, err := Connector.Connect(t.Context())
	require.NoError(t, err)
	h.mu.Lock()
	if h.DBPool == nil {
		h.DBPool = pool
	}
	pool = h.DBPool
	h.mu.Unlock()
	return pool
}
