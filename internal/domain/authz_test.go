package domain_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestAuthzHomeProjectID(t *testing.T) {
	t.Parallel()
	assert.Equal(t, "proj_home", domain.AuthzHomeProjectID("proj_home", "proj_protected"))
	assert.Equal(t, "proj_protected", domain.AuthzHomeProjectID("", "proj_protected"))
	assert.Equal(t, "proj_home", domain.AuthzCheckParams{
		ProjectID:              "proj_protected",
		PrincipalHomeProjectID: "proj_home",
	}.HomeProjectID())
	assert.Equal(t, "proj_protected", domain.AuthzCheckParams{
		ProjectID: "proj_protected",
	}.HomeProjectID())
}

func TestTeamBoundObjectType(t *testing.T) {
	t.Parallel()
	assert.True(t, domain.TeamBoundObjectType("user"))
	assert.True(t, domain.TeamBoundObjectType("team"))
	assert.True(t, domain.TeamBoundObjectType("team_membership"))
	assert.True(t, domain.TeamBoundObjectType("event"))
	assert.False(t, domain.TeamBoundObjectType("project"))
	assert.False(t, domain.TeamBoundObjectType("branding"))
	assert.False(t, domain.TeamBoundObjectType(""))
}
