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
