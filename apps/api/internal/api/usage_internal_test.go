package api

import (
	"context"
	"net/http"
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
)

// Pins the usage resource-flavored answers through the resolver gate.
func TestUsageAccessRow(t *testing.T) {
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

	if err := requireProjectAccess(operator, stmts, "proj_a", usageAccess, opRead); err != nil {
		t.Fatalf("own-project read with the project secret should pass: %v", err)
	}
	assertDomainCode(t, requireProjectAccess(operator, stmts, "proj_b", usageAccess, opRead),
		domain.ErrUsageNotFound().Code)
	assertDomainCode(t, requireProjectAccess(preview, stmts, "proj_a", usageAccess, opRead),
		domain.ErrUsagePermissionDenied().Code)
}

func TestUsageErrorStatuses(t *testing.T) {
	for _, tc := range []struct {
		err  domain.Error
		want int
	}{
		{domain.ErrUsageInvalid("to must be after from"), http.StatusBadRequest},
		{domain.ErrUsageNotFound(), http.StatusNotFound},
		{domain.ErrUsageDisabled(), http.StatusNotFound},
		{domain.ErrUsagePermissionDenied(), http.StatusForbidden},
	} {
		if got := errorResponse(tc.err).StatusCode; got != tc.want {
			t.Errorf("%s answers %d, want %d", tc.err.Code, got, tc.want)
		}
	}
}
