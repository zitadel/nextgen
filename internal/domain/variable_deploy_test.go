package domain

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResolveVariablesForDeploy(t *testing.T) {
	owner := VariableOwner{ProjectID: "p"}
	store := []*Variable{
		{Name: "GOOGLE_CLIENT_ID", Owner: owner, AppliesTo: VariableAppliesToAll, Value: "prod"},
		{Name: "GOOGLE_CLIENT_ID", Owner: owner, AppliesTo: VariableAppliesToPreview, Value: "preview"},
		{Name: "SUPPORT_EMAIL", Owner: owner, AppliesTo: VariableAppliesToAll, Value: "help@acme.com"},
		{Name: "ONLY_PREVIEW", Owner: owner, AppliesTo: VariableAppliesToPreview, Value: "x"},
	}

	t.Run("a deploy reads the all rows only", func(t *testing.T) {
		got := ResolveVariablesForDeploy(store, false)
		require.Len(t, got, 2)
		assert.Equal(t, "prod", got[0].Value)
		assert.Equal(t, "help@acme.com", got[1].Value)
	})

	t.Run("a preview prefers the override and falls back", func(t *testing.T) {
		got := ResolveVariablesForDeploy(store, true)
		require.Len(t, got, 3)
		assert.Equal(t, "preview", got[0].Value)
		assert.Equal(t, "help@acme.com", got[1].Value)
		assert.Equal(t, "x", got[2].Value)
	})

	t.Run("order of the store does not matter", func(t *testing.T) {
		reversed := []*Variable{store[1], store[0]}
		got := ResolveVariablesForDeploy(reversed, true)
		require.Len(t, got, 1)
		assert.Equal(t, "preview", got[0].Value)
	})

	t.Run("freeze and thaw round trip", func(t *testing.T) {
		frozen := FreezeVariables("dep_1", ResolveVariablesForDeploy(store, false))
		require.Len(t, frozen, 2)
		assert.Equal(t, "dep_1", frozen[0].DeploymentID)
		assert.Equal(t, "p", frozen[0].ProjectID)
		thawed := frozen[0].Thaw()
		assert.Equal(t, "GOOGLE_CLIENT_ID", thawed.Name)
		assert.Equal(t, owner, thawed.Owner)
	})
}
