package helpers

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
)

// SeedProjectViewer writes a project-scoped viewer assignment and returns it,
// so a caller that needs to revoke or inspect the grant has its minted id.
// Viewer is the weakest role: it passes read checks only. A caller that has to
// write through the session needs SeedProjectAdmin.
func (h *Harness) SeedProjectViewer(t *testing.T, projectID, userID string) *domain.AuthzAssignment {
	t.Helper()
	return h.seedProjectRole(t, projectID, userID, "viewer")
}

// SeedProjectEditor writes a project-scoped editor assignment: it passes read
// and write checks, but not admin ones such as minting or revoking grants.
func (h *Harness) SeedProjectEditor(t *testing.T, projectID, userID string) *domain.AuthzAssignment {
	t.Helper()
	return h.seedProjectRole(t, projectID, userID, "editor")
}

// SeedProjectAdmin writes a project-scoped admin assignment: the strongest
// role, which the seeded catalog closes to editor and viewer (ADR 054 §5).
func (h *Harness) SeedProjectAdmin(t *testing.T, projectID, userID string) *domain.AuthzAssignment {
	t.Helper()
	return h.seedProjectRole(t, projectID, userID, "admin")
}

func (h *Harness) seedProjectRole(t *testing.T, projectID, userID, relation string) *domain.AuthzAssignment {
	t.Helper()
	asgn := &domain.AuthzAssignment{
		ProjectID:     projectID,
		CatalogID:     domain.SystemCatalogID,
		PrincipalType: domain.AuthzPrincipalTypeUser,
		PrincipalID:   userID,
		ObjectType:    "project",
		Relation:      relation,
	}
	asgn.ApplyScope(domain.NewProjectAssignmentScope())
	require.NoError(t, h.EnsureServiceDB(t).Statements().CreateAuthzAssignment(t.Context(), asgn))
	return asgn
}
