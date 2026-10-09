package helpers

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureServiceDB(t *testing.T) *service.DB {
	t.Helper()
	require.NotNil(t, h.DB)
	return h.DB
}
