package api

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
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
