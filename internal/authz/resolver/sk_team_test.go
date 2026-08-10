package resolver

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestDecision_String(t *testing.T) {
	assert.Equal(t, "allow", DecisionAllow.String())
	assert.Equal(t, "not_found", DecisionNotFound.String())
	assert.Equal(t, "forbidden", DecisionForbidden.String())
	assert.Equal(t, "unspecified", DecisionUnspecified.String())
	assert.NotEqual(t, DecisionAllow, DecisionForbidden)
	assert.NotEqual(t, DecisionNotFound, DecisionForbidden)
}

func TestSKTeamAllowlist(t *testing.T) {
	for perm := range skTeamAllowed {
		assert.True(t, skTeamPermissionAllowed(perm), perm)
	}
	denies := []string{
		"user.set_password",
		"project.write",
		"project.read",
		"project.viewer",
		"branding.write",
		"team.create",
		"team.write",
		"billing.read",
		"unknown.perm",
		"",
	}
	for _, perm := range denies {
		assert.False(t, skTeamPermissionAllowed(perm), perm)
	}
}

func TestPermissionName(t *testing.T) {
	assert.Equal(t, "user.read", PermissionName("user", "read"))
	assert.Equal(t, "team_membership.write", PermissionName("team_membership", "write"))
}
