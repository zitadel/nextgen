package resolver

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestSKTeamAllowlist(t *testing.T) {
	for perm := range skTeamAllowed {
		assert.True(t, skTeamPermissionAllowed(perm), perm)
		objectType, _, ok := strings.Cut(perm, ".")
		assert.True(t, ok, perm)
		assert.True(t, domain.TeamBoundObjectType(objectType), perm)
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
