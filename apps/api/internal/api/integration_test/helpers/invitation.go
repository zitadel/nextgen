//go:build postgres_integration || spanner_integration || sqlite_integration

package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureInvitationService(t testing.TB) *service.InvitationService {
	t.Helper()
	h.invitationService.mutex.Lock()
	defer h.invitationService.mutex.Unlock()

	if h.invitationService.value == nil {
		db := h.EnsureServiceDB(t)
		h.invitationService.value = service.NewInvitationService(
			db,
			h.EnsureKeyService(t),
			h.EnsureGrantService(t),
			service.StatementsUserRefResolver{Pool: db},
			ConsoleOrigin+"/ui/console",
			h.EnsurePlatformProject(t).ID,
		)
	}
	return h.invitationService.value
}
