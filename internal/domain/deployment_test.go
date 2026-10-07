package domain

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewDeploymentValidates(t *testing.T) {
	t.Run("deploy to the project default", func(t *testing.T) {
		entity, err := NewDeployment("proj_1", []string{""}, "rel_1", DeploymentMetadata{Reason: DeploymentReasonDeploy})
		require.NoError(t, err)
		assert.Empty(t, entity.ID, "the id is the dialect's to mint")
		assert.Equal(t, []string{""}, entity.Origins())
		assert.True(t, entity.DeployedAt.IsZero(), "deployed_at is the insert's to stamp")
	})

	t.Run("deploy to origins normalises them", func(t *testing.T) {
		entity, err := NewDeployment("proj_1", []string{"", "HTTPS://App.Acme.com"}, "rel_1", DeploymentMetadata{})
		require.NoError(t, err)
		assert.Equal(t, []string{"", "https://app.acme.com"}, entity.Origins())
	})

	t.Run("an origin that is not one is rejected", func(t *testing.T) {
		_, err := NewDeployment("proj_1", []string{"app.acme.com/login"}, "rel_1", DeploymentMetadata{})
		assertDeploymentInvalid(t, err)
	})

	t.Run("a target listed twice is rejected", func(t *testing.T) {
		_, err := NewDeployment("proj_1", []string{"https://app.acme.com", "HTTPS://app.acme.com"}, "rel_1", DeploymentMetadata{})
		assertDeploymentInvalid(t, err)
	})

	t.Run("no target", func(t *testing.T) {
		_, err := NewDeployment("proj_1", nil, "rel_1", DeploymentMetadata{})
		assertDeploymentInvalid(t, err)
	})

	t.Run("rollback requires rollback_of", func(t *testing.T) {
		_, err := NewDeployment("proj_1", []string{""}, "rel_1", DeploymentMetadata{Reason: DeploymentReasonRollback})
		assertDeploymentInvalid(t, err)

		_, err = NewDeployment("proj_1", []string{""}, "rel_1", DeploymentMetadata{Reason: DeploymentReasonRollback, RollbackOf: new(" ")})
		assertDeploymentInvalid(t, err)

		entity, err := NewDeployment("proj_1", []string{""}, "rel_1", DeploymentMetadata{Reason: DeploymentReasonRollback, RollbackOf: new("dep_2")})
		require.NoError(t, err)
		assert.Equal(t, "dep_2", *entity.Metadata.RollbackOf)
	})

	// The field means "the deployment this one reversed", so a non-rollback
	// carrying one is rejected rather than silently dropped.
	t.Run("deploy rejects rollback_of", func(t *testing.T) {
		_, err := NewDeployment("proj_1", []string{""}, "rel_1", DeploymentMetadata{Reason: DeploymentReasonDeploy, RollbackOf: new("dep_2")})
		assertDeploymentInvalid(t, err)
	})

	t.Run("missing release", func(t *testing.T) {
		_, err := NewDeployment("proj_1", []string{""}, " ", DeploymentMetadata{Reason: DeploymentReasonDeploy})
		assertDeploymentInvalid(t, err)
	})

	t.Run("unknown reason", func(t *testing.T) {
		_, err := NewDeployment("proj_1", []string{""}, "rel_1", DeploymentMetadata{Reason: DeploymentReason(99)})
		assertDeploymentInvalid(t, err)
	})
}

func assertDeploymentInvalid(t *testing.T, err error) {
	t.Helper()
	require.Error(t, err)
	de, ok := err.(Error)
	require.True(t, ok, "expected a domain error, got %T", err)
	assert.Equal(t, ErrDeploymentInvalid(nil, nil).Code, de.Code)
}
