package authz_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/dialect/authz"
)

func TestValidateAssignment_SKTeamProjectScope(t *testing.T) {
	t.Parallel()

	teamScope := domain.NewTeamAssignmentScope("team_1")
	ok := &domain.AuthzAssignment{
		PrincipalType: domain.AuthzPrincipalTypeSKTeam,
		ObjectType:    "user",
		Relation:      "read",
	}
	ok.ApplyScope(teamScope)
	require.NoError(t, authz.ValidateAssignment(ok))

	bad := &domain.AuthzAssignment{
		PrincipalType: domain.AuthzPrincipalTypeSKTeam,
		ObjectType:    "user",
		Relation:      "read",
	}
	bad.ApplyScope(domain.NewProjectAssignmentScope())
	assert.ErrorIs(t, authz.ValidateAssignment(bad), authz.ErrSKTeamProjectScope)

	projViewer := &domain.AuthzAssignment{
		PrincipalType: domain.AuthzPrincipalTypeSKTeam,
		ObjectType:    "project",
		Relation:      "viewer",
	}
	projViewer.ApplyScope(domain.NewProjectAssignmentScope())
	require.NoError(t, authz.ValidateAssignment(projViewer), "project.viewer is not team-bound")

	userGrant := &domain.AuthzAssignment{
		PrincipalType: domain.AuthzPrincipalTypeUser,
		ObjectType:    "user",
		Relation:      "read",
	}
	userGrant.ApplyScope(domain.NewProjectAssignmentScope())
	require.NoError(t, authz.ValidateAssignment(userGrant))
}

func TestValidateAssignment_PlatformShape(t *testing.T) {
	t.Parallel()

	require.NoError(t, authz.ValidateAssignment(domain.NewPlatformOperatorAssignment("proj_platform", "user_op")))

	team := domain.NewPlatformOperatorAssignment("proj_platform", "team_ops")
	team.PrincipalType = domain.AuthzPrincipalTypeTeam
	assert.ErrorIs(t, authz.ValidateAssignment(team), authz.ErrPlatformAssignmentShape, "a team roster must not mint operators")

	secret := domain.NewPlatformOperatorAssignment("proj_platform", "proj_platform")
	secret.PrincipalType = domain.AuthzPrincipalTypeSKProj
	assert.ErrorIs(t, authz.ValidateAssignment(secret), authz.ErrPlatformAssignmentShape)

	scoped := domain.NewPlatformOperatorAssignment("proj_platform", "user_op")
	scoped.ApplyScope(domain.NewTeamAssignmentScope("team_1"))
	assert.ErrorIs(t, authz.ValidateAssignment(scoped), authz.ErrPlatformAssignmentShape)
}
