package helpers

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
)

// SeedProjectViewer writes a project-scoped viewer assignment. Until #420,
// that relation also closes editor/admin Checks on the seeded catalog.
func (h *Harness) SeedProjectViewer(t *testing.T, projectID, userID string) {
	t.Helper()
	asgn := &domain.AuthzAssignment{
		ProjectID:     projectID,
		CatalogID:     domain.SystemCatalogID,
		PrincipalType: domain.AuthzPrincipalTypeUser,
		PrincipalID:   userID,
		ObjectType:    "project",
		Relation:      "viewer",
	}
	asgn.ApplyScope(domain.NewProjectAssignmentScope())
	require.NoError(t, h.EnsureServiceDB(t).Statements().CreateAuthzAssignment(t.Context(), asgn))
}

// SeedOwningTeam writes the owning-team assignment claim/complete writes
// (ADR 046 §1), binding a team to the project's `team` relation. It is the
// shape that makes a claimer an operator: the seeded catalog resolves
// `project.viewer` for the team's members through `member from team`, so a
// test that seeds a direct user grant instead would not exercise that path.
func (h *Harness) SeedOwningTeam(t *testing.T, projectID, teamID string) {
	t.Helper()
	asgn := domain.NewClaimTeamAssignment(projectID, teamID)
	require.NoError(t, h.EnsureServiceDB(t).Statements().CreateAuthzAssignment(t.Context(), asgn))
}
