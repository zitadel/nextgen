package api

import (
	"context"
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
)

// Pins the events resource-flavored answers through the resolver gate.
func TestEventsAccessRow(t *testing.T) {
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

	if err := requireProjectAccess(operator, stmts, "proj_a", eventsAccess, opRead); err != nil {
		t.Fatalf("own-project read with the project secret should pass: %v", err)
	}
	assertDomainCode(t, requireProjectAccess(operator, stmts, "proj_b", eventsAccess, opRead),
		domain.ErrEventNotFound().Code)
	assertDomainCode(t, requireProjectAccess(preview, stmts, "proj_a", eventsAccess, opRead),
		domain.ErrEventPermissionDenied().Code)
}
