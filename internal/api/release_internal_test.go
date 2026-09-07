package api

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// Pins the release resource-flavored answers through the resolver gate. The
// pair that matters is the foreign-project one: a write reports the project as
// missing and a read reports the release as missing, so neither confirms that
// the other project exists.
func TestReleaseAccessRow(t *testing.T) {
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

	require.NoError(t, requireProjectAccess(operator, stmts, "proj_a", releaseAccess, opWrite),
		"own-project write with the project secret should pass")
	require.NoError(t, requireProjectAccess(operator, stmts, "proj_a", releaseAccess, opRead),
		"own-project read with the project secret should pass")

	assertDomainCode(t, requireProjectAccess(operator, stmts, "proj_b", releaseAccess, opWrite),
		domain.ErrReleaseProjectNotFound().Code)
	assertDomainCode(t, requireProjectAccess(operator, stmts, "proj_b", releaseAccess, opRead),
		domain.ErrReleaseNotFound().Code)

	// Releases are management-plane, so a browser credential is denied rather
	// than served a read: project.read alone never reaches the resolver.
	assertDomainCode(t, requireProjectAccess(preview, stmts, "proj_a", releaseAccess, opWrite),
		domain.ErrReleasePermissionDenied().Code)
	assertDomainCode(t, requireProjectAccess(preview, stmts, "proj_a", releaseAccess, opRead),
		domain.ErrReleasePermissionDenied().Code)

	// No credential at all answers as a miss, not as a denial, for the same
	// reason the foreign-project case does.
	assertDomainCode(t, requireProjectAccess(context.Background(), stmts, "proj_a", releaseAccess, opWrite),
		domain.ErrReleaseProjectNotFound().Code)
	assertDomainCode(t, requireProjectAccess(context.Background(), stmts, "proj_a", releaseAccess, opRead),
		domain.ErrReleaseNotFound().Code)

	t.Run("foothold but missing permission is forbidden", func(t *testing.T) {
		deny := false
		foothold := true
		narrow := stubAuthzStmts{allowCheck: &deny, foothold: &foothold}
		assertDomainCode(t, requireProjectAccess(operator, narrow, "proj_a", releaseAccess, opWrite),
			domain.ErrReleasePermissionDenied().Code)
	})
}

// Listing narrows rather than refusing when the credential holds a foothold in
// the project but not the permission, so a partial view is a page of the
// releases the caller may see instead of a 403.
func TestReleaseListAccess(t *testing.T) {
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

	ctx, err := requireProjectListAccess(operator, stmts, "proj_a", releaseAccess, domain.ResourceKindRelease)
	if err != nil {
		t.Fatalf("project-wide Allow should proceed: %v", err)
	}
	if !service.AuthzListSkipOncePending(ctx) {
		t.Fatal("Allow must stamp a one-shot EXISTS skip")
	}
	if _, ok := service.AuthzListFilterFromContext(ctx); ok {
		t.Fatal("Allow must not attach EXISTS")
	}

	deny := false
	foothold := true
	narrow := stubAuthzStmts{allowCheck: &deny, foothold: &foothold}
	ctx, err = requireProjectListAccess(operator, narrow, "proj_a", releaseAccess, domain.ResourceKindRelease)
	if err != nil {
		t.Fatalf("Forbidden with foothold should proceed for partial-view lists: %v", err)
	}
	filter, ok := service.AuthzListFilterFromContext(ctx)
	if !ok {
		t.Fatal("Forbidden must attach the EXISTS list filter")
	}
	// The kind is what scopes the filter to releases; the wrong one here would
	// silently filter the list against another resource's scope rows.
	if filter.ResourceKind != domain.ResourceKindRelease {
		t.Fatalf("filter kind = %q, want release", filter.ResourceKind)
	}

	// Reads miss rather than deny, so the list is no oracle for projects the
	// caller cannot see.
	_, err = requireProjectListAccess(operator, stmts, "proj_b", releaseAccess, domain.ResourceKindRelease)
	assertDomainCode(t, err, domain.ErrReleaseNotFound().Code)

	_, err = requireProjectListAccess(preview, stmts, "proj_a", releaseAccess, domain.ResourceKindRelease)
	assertDomainCode(t, err, domain.ErrReleasePermissionDenied().Code)

	_, err = requireProjectListAccess(context.Background(), stmts, "proj_a", releaseAccess, domain.ResourceKindRelease)
	assertDomainCode(t, err, domain.ErrReleaseNotFound().Code)
}
