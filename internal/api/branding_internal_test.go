package api

import (
	"context"
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
)

// Pins the branding resource-flavored answers through the resolver gate.
func TestBrandingAccessRow(t *testing.T) {
	stmts := stubAuthzStmts{}
	operator := WithScopeContext(context.Background(), ScopeContext{
		ProjectID:     "proj_a",
		Scope:         []string{"project.write", "project.read"},
		PrincipalType: domain.AuthzPrincipalTypeSKProj,
		PrincipalID:   "proj_a",
	})
	preview := WithScopeContext(context.Background(), ScopeContext{
		ProjectID:     "proj_a",
		Scope:         []string{"project.read"},
		PrincipalType: domain.AuthzPrincipalTypeSKProj,
		PrincipalID:   "proj_a",
	})

	if err := requireProjectAccess(operator, stmts, "proj_a", brandingAccess, opWrite); err != nil {
		t.Fatalf("own-project write with the project secret should pass: %v", err)
	}
	assertDomainCode(t, requireProjectAccess(operator, stmts, "proj_b", brandingAccess, opWrite),
		domain.ErrBrandingInvalid(nil, nil).Code)
	assertDomainCode(t, requireProjectAccess(operator, stmts, "proj_b", brandingAccess, opRead),
		domain.ErrBrandingNotFound().Code)
	assertDomainCode(t, requireProjectAccess(preview, stmts, "proj_a", brandingAccess, opWrite),
		domain.ErrBrandingPermissionDenied().Code)
	assertDomainCode(t, requireProjectAccess(preview, stmts, "proj_a", brandingAccess, opRead),
		domain.ErrBrandingPermissionDenied().Code)
}
