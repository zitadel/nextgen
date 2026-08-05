package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureTeamService(t *testing.T) *service.TeamService {
	t.Helper()
	h.teamService.mutex.Lock()
	defer h.teamService.mutex.Unlock()

	if h.teamService.value == nil {
		h.teamService.value = service.NewTeamService(
			h.EnsureServiceDB(t),
		)
	}
	return h.teamService.value
}
