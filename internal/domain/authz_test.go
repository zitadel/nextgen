package domain_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/zitadel/nextgen/internal/domain"
)

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
