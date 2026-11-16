//go:build postgres_integration || spanner_integration || sqlite_integration

package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureGrantService(t testing.TB) *service.GrantService {
	t.Helper()
	h.grantService.mutex.Lock()
	defer h.grantService.mutex.Unlock()

	if h.grantService.value == nil {
		db := h.EnsureServiceDB(t)
		h.grantService.value = service.NewGrantService(
			db,
			service.StatementsUserRefResolver{Pool: db},
			h.EnsurePlatformProject(t).ID,
		)
	}
	return h.grantService.value
}
