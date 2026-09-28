package helpers

import (
	"context"
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
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

type TeamMembershipFixture struct {
	Pool *service.DB
}

func (h *Harness) EnsureTeamMembershipFixture(t *testing.T) TeamMembershipFixture {
	t.Helper()
	return TeamMembershipFixture{Pool: h.EnsureServiceDB(t)}
}

func (f TeamMembershipFixture) Create(ctx context.Context, membership *domain.TeamMembership) error {
	return f.Pool.Transaction(ctx, func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
		return tx.Statements().CreateTeamMembership(ctx, membership)
	})
}
