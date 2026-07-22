package api

import (
	"context"
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
)

// The guard mechanics (binding, anti-oracle, scope implication) are covered
// by authz_internal_test.go; this pins the branding row of the access model:
// its scope classes and the three resource-flavored answers.
func TestBrandingAccessRow(t *testing.T) {
	scopeCases := []struct {
		name  string
		op    accessOp
		scope string
		want  bool
	}{
		{"branding.write writes", opWrite, "branding.write", true},
		{"branding.write implies read", opRead, "branding.write", true},
		{"branding.read reads", opRead, "branding.read", true},
		{"branding.read cannot write", opWrite, "branding.read", false},
		{"preview secret grants nothing", opRead, "project.read", false},
	}
	for _, tt := range scopeCases {
		t.Run(tt.name, func(t *testing.T) {
			if got := scopeAllowed([]string{tt.scope}, brandingAccess.scopes[tt.op]); got != tt.want {
				t.Fatalf("scopeAllowed(%q, %v) = %v, want %v", tt.scope, tt.op, got, tt.want)
			}
		})
	}

	operator := WithScopeContext(context.Background(), ScopeContext{
		ProjectID: "proj_a",
		Scope:     []string{"project.write", "project.read"},
	})
	preview := WithScopeContext(context.Background(), ScopeContext{
		ProjectID: "proj_a",
		Scope:     []string{"project.read"},
	})

	if err := requireProjectAccess(operator, "proj_a", brandingAccess, opWrite); err != nil {
		t.Fatalf("own-project write with the project secret should pass: %v", err)
	}
	assertDomainCode(t, requireProjectAccess(operator, "proj_b", brandingAccess, opWrite),
		domain.ErrBrandingInvalid(nil, nil).Code)
	assertDomainCode(t, requireProjectAccess(operator, "proj_b", brandingAccess, opRead),
		domain.ErrBrandingNotFound().Code)
	assertDomainCode(t, requireProjectAccess(preview, "proj_a", brandingAccess, opWrite),
		domain.ErrBrandingPermissionDenied().Code)
	assertDomainCode(t, requireProjectAccess(preview, "proj_a", brandingAccess, opRead),
		domain.ErrBrandingPermissionDenied().Code)
}
