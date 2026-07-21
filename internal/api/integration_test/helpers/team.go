package helpers

import (
	"testing"

	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsureTeamService(t *testing.T) *service.TeamService {
	t.Helper()
	if h.TeamService == nil {
		h.TeamService = service.NewTeamService(
			h.ServiceDB(t),
		)
	}
	return h.TeamService
}
