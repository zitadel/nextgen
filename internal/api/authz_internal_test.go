package api

import (
	"context"
	"testing"

	"github.com/zitadel/nextgen/internal/authz/resolver"
	"github.com/zitadel/nextgen/internal/domain"
)

// stubAuthzStmts is a minimal AuthzResolverStatements for gate unit tests.
// It treats principal_id == project_id as a foothold with CheckAuthz success
// (mirroring the CreateProject sk_proj seed), and no foothold otherwise.
type stubAuthzStmts struct {
	// allowCheck overrides CheckAuthz when set; nil means default foothold rule.
	allowCheck *bool
	foothold   *bool
}

func (stubAuthzStmts) IsStatements() {}

func (s stubAuthzStmts) ActiveSystemCatalogID(context.Context) (string, error) {
	return domain.SystemCatalogID, nil
}

func (s stubAuthzStmts) HasAuthzProjectFoothold(_ context.Context, projectID string, _ domain.AuthzPrincipalType, principalID string) (bool, error) {
	if s.foothold != nil {
		return *s.foothold, nil
	}
	return principalID == projectID, nil
}

func (s stubAuthzStmts) CheckAuthz(_ context.Context, params domain.AuthzCheckParams) (bool, bool, error) {
	foothold, err := s.HasAuthzProjectFoothold(context.Background(), params.ProjectID, params.PrincipalType, params.PrincipalID)
	if err != nil {
		return false, false, err
	}
	if s.allowCheck != nil {
		return *s.allowCheck, foothold, nil
	}
	return params.PrincipalID == params.ProjectID, foothold, nil
}

func (s stubAuthzStmts) ListAuthzObjectIDs(context.Context, domain.AuthzListObjectsParams) ([]string, error) {
	return nil, nil
}

func TestProjectRelation(t *testing.T) {
	if got := projectRelation(opRead); got != "viewer" {
		t.Fatalf("opRead → %q, want viewer", got)
	}
	if got := projectRelation(opWrite); got != "editor" {
		t.Fatalf("opWrite → %q, want editor", got)
	}
	if got := projectRelation(opDelete); got != "admin" {
		t.Fatalf("opDelete → %q, want admin", got)
	}
}

func TestTokenScopeAllowsRelation(t *testing.T) {
	tests := []struct {
		name     string
		granted  []string
		relation string
		want     bool
	}{
		{"project secret reads", []string{"project.write", "project.read"}, "viewer", true},
		{"project secret writes", []string{"project.write", "project.read"}, "editor", true},
		{"project secret deletes", []string{"project.write", "project.read"}, "admin", true},
		{"preview cannot read management", []string{"project.read"}, "viewer", false},
		{"preview cannot write", []string{"project.read"}, "editor", false},
		{"preview cannot delete", []string{"project.read"}, "admin", false},
		{"write alone unlocks", []string{"project.write"}, "viewer", true},
		{"empty denies", nil, "viewer", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tokenScopeAllowsRelation(tt.granted, tt.relation); got != tt.want {
				t.Fatalf("tokenScopeAllowsRelation(%v, %q) = %v, want %v", tt.granted, tt.relation, got, tt.want)
			}
		})
	}
}

func TestMapAuthzDecision(t *testing.T) {
	res := userAccess
	if err := mapAuthzDecision(resolver.DecisionAllow, res, opRead); err != nil {
		t.Fatalf("Allow: %v", err)
	}
	assertDomainCode(t, mapAuthzDecision(resolver.DecisionForbidden, res, opRead), domain.ErrUserPermissionDenied().Code)
	assertDomainCode(t, mapAuthzDecision(resolver.DecisionNotFound, res, opRead), domain.ErrUserNotFound().Code)
	assertDomainCode(t, mapAuthzDecision(resolver.DecisionNotFound, res, opWrite), domain.ErrUserInvalid().Code)
}

func TestRequireProjectAccess(t *testing.T) {
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

	resources := []struct {
		name string
		res  resourceAccess
		// expected error codes
		readMiss, writeMiss, denied string
	}{
		{
			name: "schema", res: schemaAccess,
			readMiss: domain.ErrJSONSchemaNotFound().Code, writeMiss: domain.ErrJSONSchemaInvalid().Code,
			denied: domain.ErrJSONSchemaPermissionDenied().Code,
		},
		{
			name: "flow definition", res: flowDefinitionAccess,
			readMiss: domain.ErrFlowDefinitionNotFound().Code, writeMiss: domain.ErrFlowDefinitionInvalid(nil, nil).Code,
			denied: domain.ErrFlowDefinitionPermissionDenied().Code,
		},
		{
			name: "user", res: userAccess,
			readMiss: domain.ErrUserNotFound().Code, writeMiss: domain.ErrUserInvalid().Code,
			denied: domain.ErrUserPermissionDenied().Code,
		},
		{
			name: "team", res: teamAccess,
			readMiss: domain.ErrTeamNotFound().Code, writeMiss: domain.ErrTeamProjectNotFound().Code,
			denied: domain.ErrTeamPermissionDenied().Code,
		},
		{
			name: "project", res: projectAccess,
			readMiss: domain.ErrProjectNotFound().Code, writeMiss: domain.ErrProjectNotFound().Code,
			denied: domain.ErrProjectPermissionDenied().Code,
		},
		{
			name: "branding", res: brandingAccess,
			readMiss: domain.ErrBrandingNotFound().Code, writeMiss: domain.ErrBrandingInvalid(nil, nil).Code,
			denied: domain.ErrBrandingPermissionDenied().Code,
		},
		{
			name: "session", res: sessionAccess,
			readMiss: domain.ErrSessionNotFound().Code, writeMiss: domain.ErrSessionNotFound().Code,
			denied: domain.ErrSessionPermissionDenied().Code,
		},
	}

	for _, res := range resources {
		t.Run(res.name, func(t *testing.T) {
			if err := requireProjectAccess(operator, stmts, "proj_a", res.res, opWrite); err != nil {
				t.Fatalf("own-project write with the project secret should pass: %v", err)
			}
			if err := requireProjectAccess(operator, stmts, "proj_a", res.res, opRead); err != nil {
				t.Fatalf("own-project read with the project secret should pass: %v", err)
			}
			if err := requireProjectAccess(operator, stmts, "proj_a", res.res, opDelete); err != nil {
				t.Fatalf("own-project delete with the project secret should pass: %v", err)
			}

			// Foreign projects: no foothold → not-found shapes (anti-oracle).
			err := requireProjectAccess(operator, stmts, "proj_b", res.res, opWrite)
			assertDomainCode(t, err, res.writeMiss)
			err = requireProjectAccess(operator, stmts, "proj_b", res.res, opRead)
			assertDomainCode(t, err, res.readMiss)

			// Preview is browser-plane: no management access, not even reads.
			err = requireProjectAccess(preview, stmts, "proj_a", res.res, opRead)
			assertDomainCode(t, err, res.denied)
			err = requireProjectAccess(preview, stmts, "proj_a", res.res, opWrite)
			assertDomainCode(t, err, res.denied)
			err = requireProjectAccess(preview, stmts, "proj_a", res.res, opDelete)
			assertDomainCode(t, err, res.denied)

			err = requireProjectAccess(context.Background(), stmts, "proj_a", res.res, opRead)
			assertDomainCode(t, err, res.readMiss)
		})
	}

	t.Run("foothold but missing permission is forbidden", func(t *testing.T) {
		deny := false
		foothold := true
		narrow := stubAuthzStmts{allowCheck: &deny, foothold: &foothold}
		err := requireProjectAccess(operator, narrow, "proj_a", userAccess, opWrite)
		assertDomainCode(t, err, domain.ErrUserPermissionDenied().Code)
	})
}

func TestRequireUserTeamsAccess(t *testing.T) {
	stmts := stubAuthzStmts{}
	h := &Handler{pool: nil} // use package helper via local wrap
	_ = h

	both := WithScopeContext(context.Background(), ScopeContext{
		ProjectID: "proj_a", Scope: []string{"project.write", "project.read"},
		PrincipalType: domain.AuthzPrincipalTypeSKProj, PrincipalID: "proj_a",
	})
	preview := WithScopeContext(context.Background(), ScopeContext{
		ProjectID: "proj_a", Scope: []string{"project.read"},
		PrincipalType: domain.AuthzPrincipalTypeSKProj, PrincipalID: "proj_a",
	})

	if err := requireProjectAccess(both, stmts, "proj_a", userAccess, opRead); err != nil {
		t.Fatalf("user read: %v", err)
	}
	if err := requireProjectAccess(both, stmts, "proj_a", teamAccess, opRead); err != nil {
		t.Fatalf("team read: %v", err)
	}
	assertDomainCode(t, requireProjectAccess(preview, stmts, "proj_a", userAccess, opRead), domain.ErrUserPermissionDenied().Code)
	assertDomainCode(t, requireProjectAccess(both, stmts, "proj_b", userAccess, opRead), domain.ErrUserNotFound().Code)
}

func TestRequireTeamDelete(t *testing.T) {
	stmts := stubAuthzStmts{}
	operator := WithScopeContext(context.Background(), ScopeContext{
		ProjectID: "proj_a", Scope: []string{"project.write", "project.read"},
		PrincipalType: domain.AuthzPrincipalTypeSKProj, PrincipalID: "proj_a",
	})
	preview := WithScopeContext(context.Background(), ScopeContext{
		ProjectID: "proj_a", Scope: []string{"project.read"},
		PrincipalType: domain.AuthzPrincipalTypeSKProj, PrincipalID: "proj_a",
	})

	// Mirror Handler.requireTeamDelete wrapping.
	wrap := func(err error) error {
		if err != nil {
			return domain.ErrTeamPermissionDenied().WithParent(err)
		}
		return nil
	}

	if err := wrap(requireProjectAccess(operator, stmts, "proj_a", teamAccess, opDelete)); err != nil {
		t.Fatalf("own-project delete should pass: %v", err)
	}
	assertDomainCode(t, wrap(requireProjectAccess(operator, stmts, "proj_b", teamAccess, opDelete)),
		domain.ErrTeamPermissionDenied().Code)
	assertDomainCode(t, wrap(requireProjectAccess(preview, stmts, "proj_a", teamAccess, opDelete)),
		domain.ErrTeamPermissionDenied().Code)
	assertDomainCode(t, wrap(requireProjectAccess(context.Background(), stmts, "proj_a", teamAccess, opDelete)),
		domain.ErrTeamPermissionDenied().Code)
}

func assertDomainCode(t *testing.T, err error, wantCode string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected domain error %q, got nil", wantCode)
	}
	de, ok := err.(domain.Error)
	if !ok {
		t.Fatalf("expected domain.Error, got %T: %v", err, err)
	}
	if de.Code != wantCode {
		t.Fatalf("error code = %q, want %q (%v)", de.Code, wantCode, err)
	}
}
