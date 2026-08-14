package api

import (
	"context"
	"errors"
	"testing"

	"github.com/zitadel/nextgen/internal/authz/resolver"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// stubAuthzStmts is a minimal AuthzResolverStatements for gate unit tests.
// It treats principal_id == project_id as a foothold with CheckAuthz success
// (mirroring the CreateProject sk_proj seed), and no foothold otherwise.
type stubAuthzStmts struct {
	// allowCheck overrides CheckAuthz when set; nil means default foothold rule.
	allowCheck *bool
	foothold   *bool
	// scopes maps resource_id → project_id for GetResourceScope; missing → NoRowFoundError.
	scopes map[string]string
	// kinds maps resource_id → ResourceKind; when absent, ResourceKindUser is used.
	kinds map[string]domain.ResourceKind
	// elsewhere forces ExistsResourceScopeElsewhere for a resource_id (shared URL across foreign projects).
	elsewhere map[string]bool
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

func (s stubAuthzStmts) CheckAuthz(ctx context.Context, params domain.AuthzCheckParams) (bool, bool, error) {
	foothold, err := s.HasAuthzProjectFoothold(ctx, params.ProjectID, params.PrincipalType, params.PrincipalID)
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

func (stubAuthzStmts) ListClaimedProjectIDs(context.Context, string, uint32) ([]string, error) {
	return nil, nil
}

func (s stubAuthzStmts) GetResourceScope(_ context.Context, resourceID string) (*domain.ResourceScope, error) {
	if s.scopes == nil {
		return nil, new(database.NoRowFoundError)
	}
	projectID, ok := s.scopes[resourceID]
	if !ok {
		return nil, new(database.NoRowFoundError)
	}
	kind := domain.ResourceKindUser
	if s.kinds != nil {
		if k, ok := s.kinds[resourceID]; ok {
			kind = k
		}
	}
	return &domain.ResourceScope{ResourceID: resourceID, ProjectID: projectID, ResourceKind: kind}, nil
}

func (s stubAuthzStmts) GetResourceScopeInProject(_ context.Context, kind domain.ResourceKind, projectID, resourceID string) (*domain.ResourceScope, error) {
	scope, err := s.GetResourceScopeByIDInProject(context.Background(), projectID, resourceID)
	if err != nil {
		return nil, err
	}
	if scope.ResourceKind != kind {
		return nil, new(database.NoRowFoundError)
	}
	return scope, nil
}

func (s stubAuthzStmts) GetResourceScopeByIDInProject(_ context.Context, projectID, resourceID string) (*domain.ResourceScope, error) {
	scope, err := s.GetResourceScope(context.Background(), resourceID)
	if err != nil {
		return nil, err
	}
	if scope.ProjectID != projectID {
		return nil, new(database.NoRowFoundError)
	}
	return scope, nil
}

func (s stubAuthzStmts) ExistsResourceScopeElsewhere(_ context.Context, kind domain.ResourceKind, resourceID, excludeProjectID string) (bool, error) {
	if s.elsewhere != nil {
		if v, ok := s.elsewhere[resourceID]; ok {
			return v, nil
		}
	}
	scope, err := s.GetResourceScope(context.Background(), resourceID)
	if err != nil {
		if errors.Is(err, new(database.NoRowFoundError)) {
			return false, nil
		}
		return false, err
	}
	if kind != "" && scope.ResourceKind != kind {
		return false, nil
	}
	return scope.ProjectID != excludeProjectID, nil
}

func (stubAuthzStmts) UpsertResourceScope(context.Context, *domain.ResourceScope) error { return nil }

func (stubAuthzStmts) DeleteResourceScope(context.Context, domain.ResourceKind, string, string) error {
	return nil
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

func TestHasOperatorProjectWrite(t *testing.T) {
	tests := []struct {
		name    string
		granted []string
		want    bool
	}{
		{"project secret", []string{"project.write", "project.read"}, true},
		{"write alone", []string{"project.write"}, true},
		{"preview", []string{"project.read"}, false},
		{"empty", nil, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := hasOperatorProjectWrite(tt.granted); got != tt.want {
				t.Fatalf("hasOperatorProjectWrite(%v) = %v, want %v", tt.granted, got, tt.want)
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

	assertDomainCode(t, mapAuthzDecisionAfterRSI(resolver.DecisionNotFound, res), domain.ErrUserNotFound().Code)
	assertDomainCode(t, mapAuthzDecisionAfterRSI(resolver.DecisionForbidden, res), domain.ErrUserPermissionDenied().Code)
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
		{
			name: "events", res: eventsAccess,
			readMiss: domain.ErrEventNotFound().Code, writeMiss: domain.ErrEventNotFound().Code,
			denied: domain.ErrEventPermissionDenied().Code,
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

func TestRequireProjectListAccess(t *testing.T) {
	stmts := stubAuthzStmts{}
	operator := WithScopeContext(context.Background(), ScopeContext{
		ProjectID: "proj_a", Scope: []string{"project.write", "project.read"},
		PrincipalType: domain.AuthzPrincipalTypeSKProj, PrincipalID: "proj_a",
	})
	preview := WithScopeContext(context.Background(), ScopeContext{
		ProjectID: "proj_a", Scope: []string{"project.read"},
		PrincipalType: domain.AuthzPrincipalTypeSKProj, PrincipalID: "proj_a",
	})

	ctx, err := requireProjectListAccess(operator, stmts, "proj_a", userAccess, domain.ResourceKindUser)
	if err != nil {
		t.Fatalf("project-wide Allow should proceed: %v", err)
	}
	if !service.AuthzListUnrestricted(ctx) {
		t.Fatal("Allow must skip the EXISTS list filter")
	}
	if _, ok := service.AuthzListFilterFromContext(ctx); ok {
		t.Fatal("Allow must not attach EXISTS")
	}

	deny := false
	foothold := true
	narrow := stubAuthzStmts{allowCheck: &deny, foothold: &foothold}
	ctx, err = requireProjectListAccess(operator, narrow, "proj_a", userAccess, domain.ResourceKindUser)
	if err != nil {
		t.Fatalf("Forbidden with foothold should proceed for partial-view lists: %v", err)
	}
	if service.AuthzListUnrestricted(ctx) {
		t.Fatal("Forbidden must not mark the list unrestricted")
	}
	filter, ok := service.AuthzListFilterFromContext(ctx)
	if !ok {
		t.Fatal("Forbidden must attach the EXISTS list filter")
	}
	if filter.ResourceKind != domain.ResourceKindUser {
		t.Fatalf("filter kind = %q, want user", filter.ResourceKind)
	}
	if filter.ConstraintTeamID != "" {
		t.Fatalf("sk_proj filter ConstraintTeamID = %q, want empty", filter.ConstraintTeamID)
	}

	_, err = requireProjectListAccess(operator, stmts, "proj_b", userAccess, domain.ResourceKindUser)
	assertDomainCode(t, err, domain.ErrUserNotFound().Code)

	_, err = requireProjectListAccess(preview, stmts, "proj_a", userAccess, domain.ResourceKindUser)
	assertDomainCode(t, err, domain.ErrUserPermissionDenied().Code)

	_, err = requireProjectListAccess(context.Background(), stmts, "proj_a", userAccess, domain.ResourceKindUser)
	assertDomainCode(t, err, domain.ErrUserNotFound().Code)
}

func TestWithAuthzListFilterCopiesConstraintTeamID(t *testing.T) {
	stmts := stubAuthzStmts{}
	ctx := WithScopeContext(context.Background(), ScopeContext{
		ProjectID: "proj_a", Scope: []string{"project.write", "project.read"},
		PrincipalType: domain.AuthzPrincipalTypeSKTeam, PrincipalID: "sk_team_1",
		TeamID: "team_eng",
	})
	ctx, err := withAuthzListFilter(ctx, resolver.New(), stmts, "proj_a", domain.ResourceKindUser, opRead)
	if err != nil {
		t.Fatalf("withAuthzListFilter: %v", err)
	}
	filter, ok := service.AuthzListFilterFromContext(ctx)
	if !ok {
		t.Fatal("expected list filter")
	}
	if filter.ConstraintTeamID != "team_eng" {
		t.Fatalf("ConstraintTeamID = %q, want team_eng", filter.ConstraintTeamID)
	}
}

func TestListUserTeamsGateShape(t *testing.T) {
	stmts := stubAuthzStmts{}
	both := WithScopeContext(context.Background(), ScopeContext{
		ProjectID: "proj_a", Scope: []string{"project.write", "project.read"},
		PrincipalType: domain.AuthzPrincipalTypeSKProj, PrincipalID: "proj_a",
	})
	preview := WithScopeContext(context.Background(), ScopeContext{
		ProjectID: "proj_a", Scope: []string{"project.read"},
		PrincipalType: domain.AuthzPrincipalTypeSKProj, PrincipalID: "proj_a",
	})

	// listUserTeams uses requireResourceAccess with the user miss shape.
	if err := requireProjectAccess(both, stmts, "proj_a", userAccess, opRead); err != nil {
		t.Fatalf("user read: %v", err)
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

	// Mirror Handler.requireTeamDelete wrapping (pass ErrInternal through).
	wrap := func(err error) error {
		if err == nil {
			return nil
		}
		if errors.Is(err, errResourceGone) || errors.Is(err, domain.ErrInternal(nil)) {
			return err
		}
		return domain.ErrTeamPermissionDenied().WithParent(err)
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

	internal := domain.ErrInternal(errors.New("db down")).WithMessage("authz permission check failed")
	if got := wrap(internal); !errors.Is(got, domain.ErrInternal(nil)) {
		t.Fatalf("wrap(%v) = %v, want ErrInternal passthrough", internal, got)
	}
}

func TestRequireResourceAccess(t *testing.T) {
	stmts := stubAuthzStmts{scopes: map[string]string{"usr_a": "proj_a", "usr_b": "proj_b"}}
	operator := WithScopeContext(context.Background(), ScopeContext{
		ProjectID: "proj_a", Scope: []string{"project.write", "project.read"},
		PrincipalType: domain.AuthzPrincipalTypeSKProj, PrincipalID: "proj_a",
	})
	preview := WithScopeContext(context.Background(), ScopeContext{
		ProjectID: "proj_a", Scope: []string{"project.read"},
		PrincipalType: domain.AuthzPrincipalTypeSKProj, PrincipalID: "proj_a",
	})

	projectID, err := requireResourceAccess(operator, stmts, "usr_a", userAccess, opRead)
	if err != nil {
		t.Fatalf("own-project resource: %v", err)
	}
	if projectID != "proj_a" {
		t.Fatalf("projectID = %q, want proj_a", projectID)
	}

	_, err = requireResourceAccess(operator, stmts, "usr_missing", userAccess, opRead)
	assertDomainCode(t, err, domain.ErrUserNotFound().Code)

	_, err = requireResourceAccess(operator, stmts, "usr_missing", userAccess, opWrite)
	assertDomainCode(t, err, domain.ErrUserNotFound().Code)

	_, err = requireResourceAccess(operator, stmts, "usr_missing", userAccess, opDelete)
	if !errors.Is(err, errResourceGone) {
		t.Fatalf("operator delete RSI miss: %v, want errResourceGone", err)
	}

	_, err = requireResourceAccess(preview, stmts, "usr_missing", userAccess, opDelete)
	assertDomainCode(t, err, domain.ErrUserNotFound().Code)

	_, err = requireResourceAccess(context.Background(), stmts, "usr_missing", userAccess, opDelete)
	assertDomainCode(t, err, domain.ErrUserNotFound().Code)

	_, err = requireResourceAccess(operator, stmts, "usr_b", userAccess, opRead)
	assertDomainCode(t, err, domain.ErrUserNotFound().Code)

	// Foreign delete of a real id must not 204 — anti-oracle readMiss.
	_, err = requireResourceAccess(operator, stmts, "usr_b", userAccess, opDelete)
	assertDomainCode(t, err, domain.ErrUserNotFound().Code)

	_, err = requireResourceAccess(operator, stmts, "usr_b", userAccess, opWrite)
	assertDomainCode(t, err, domain.ErrUserNotFound().Code)

	_, err = requireResourceAccess(preview, stmts, "usr_a", userAccess, opRead)
	assertDomainCode(t, err, domain.ErrUserPermissionDenied().Code)

	_, err = requireResourceAccess(preview, stmts, "usr_a", userAccess, opDelete)
	assertDomainCode(t, err, domain.ErrUserPermissionDenied().Code)
}

func TestRequireResourceAccessWrongKind(t *testing.T) {
	stmts := stubAuthzStmts{
		scopes: map[string]string{"id_shared": "proj_a"},
		kinds:  map[string]domain.ResourceKind{"id_shared": domain.ResourceKindSchema},
	}
	operator := WithScopeContext(context.Background(), ScopeContext{
		ProjectID: "proj_a", Scope: []string{"project.write", "project.read"},
		PrincipalType: domain.AuthzPrincipalTypeSKProj, PrincipalID: "proj_a",
	})

	_, err := requireResourceAccess(operator, stmts, "id_shared", userAccess, opRead)
	assertDomainCode(t, err, domain.ErrUserNotFound().Code)

	_, err = requireResourceAccess(operator, stmts, "id_shared", userAccess, opDelete)
	assertDomainCode(t, err, domain.ErrUserNotFound().Code)
}

func TestRequireResourceAccessDeleteSharedURLElsewhere(t *testing.T) {
	// Schema $id shared by two foreign projects: ExistsResourceScopeElsewhere is
	// true even though GetResourceScope would be ambiguous. Operator delete must
	// readMiss (never 204).
	stmts := stubAuthzStmts{
		elsewhere: map[string]bool{"https://example.com/x.json": true},
	}
	operator := WithScopeContext(context.Background(), ScopeContext{
		ProjectID: "proj_a", Scope: []string{"project.write", "project.read"},
		PrincipalType: domain.AuthzPrincipalTypeSKProj, PrincipalID: "proj_a",
	})

	_, err := requireResourceAccess(operator, stmts, "https://example.com/x.json", schemaAccess, opDelete)
	assertDomainCode(t, err, domain.ErrJSONSchemaNotFound().Code)
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
