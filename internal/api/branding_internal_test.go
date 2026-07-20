package api

import (
	"context"
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestBrandingScopeAllowed(t *testing.T) {
	tests := []struct {
		name   string
		scopes []string
		write  bool
		want   bool
	}{
		{"project secret writes", []string{"project.write", "project.read"}, true, true},
		{"project secret reads", []string{"project.write", "project.read"}, false, true},
		{"preview secret cannot write", []string{"project.read"}, true, false},
		{"preview secret cannot read the management API", []string{"project.read"}, false, false},
		{"branding.write writes", []string{"branding.write"}, true, true},
		{"branding.write implies read", []string{"branding.write"}, false, true},
		{"branding.read reads", []string{"branding.read"}, false, true},
		{"branding.read cannot write", []string{"branding.read"}, true, false},
		{"no scopes", nil, true, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := brandingScopeAllowed(tt.scopes, tt.write); got != tt.want {
				t.Fatalf("brandingScopeAllowed(%v, write=%v) = %v, want %v", tt.scopes, tt.write, got, tt.want)
			}
		})
	}
}

func TestRequireBrandingAccess(t *testing.T) {
	operator := WithScopeContext(context.Background(), ScopeContext{
		ProjectID: "proj_a",
		Scope:     []string{"project.write", "project.read"},
	})
	preview := WithScopeContext(context.Background(), ScopeContext{
		ProjectID: "proj_a",
		Scope:     []string{"project.read"},
	})

	if err := requireBrandingAccess(operator, "proj_a", true); err != nil {
		t.Fatalf("own-project write with the project secret should pass: %v", err)
	}

	// Foreign projects answer exactly like nonexistent ones (anti-oracle).
	err := requireBrandingAccess(operator, "proj_b", true)
	assertDomainCode(t, err, domain.ErrBrandingInvalid(nil, nil).Code)
	err = requireBrandingAccess(operator, "proj_b", false)
	assertDomainCode(t, err, domain.ErrBrandingNotFound().Code)

	// The preview secret is a login-plane credential: no management access.
	err = requireBrandingAccess(preview, "proj_a", true)
	assertDomainCode(t, err, domain.ErrBrandingPermissionDenied().Code)
	err = requireBrandingAccess(preview, "proj_a", false)
	assertDomainCode(t, err, domain.ErrBrandingPermissionDenied().Code)

	// No scope context at all behaves like a foreign project.
	err = requireBrandingAccess(context.Background(), "proj_a", false)
	assertDomainCode(t, err, domain.ErrBrandingNotFound().Code)
}

func assertDomainCode(t *testing.T, err error, want string) {
	t.Helper()
	if err == nil {
		t.Fatal("expected an error")
	}
	domErr, ok := err.(domain.Error)
	if !ok {
		t.Fatalf("expected a domain.Error, got %T: %v", err, err)
	}
	if domErr.Code != want {
		t.Fatalf("code = %q, want %q", domErr.Code, want)
	}
}
