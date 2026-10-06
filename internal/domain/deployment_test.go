package domain

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewDeploymentValidates(t *testing.T) {
	t.Run("deploy to the project default", func(t *testing.T) {
		entity, err := NewDeployment("proj_1", "", "rel_1", DeploymentMetadata{Reason: DeploymentReasonDeploy})
		require.NoError(t, err)
		assert.Empty(t, entity.ID, "the id is the dialect's to mint")
		assert.Empty(t, entity.Origin)
		assert.True(t, entity.DeployedAt.IsZero(), "deployed_at is the insert's to stamp")
	})

	t.Run("deploy to an origin normalises it", func(t *testing.T) {
		entity, err := NewDeployment("proj_1", "HTTPS://App.Acme.com", "rel_1", DeploymentMetadata{})
		require.NoError(t, err)
		assert.Equal(t, "https://app.acme.com", entity.Origin)
	})

	t.Run("an origin that is not one is rejected", func(t *testing.T) {
		_, err := NewDeployment("proj_1", "app.acme.com/login", "rel_1", DeploymentMetadata{})
		assertDeploymentInvalid(t, err)
	})

	t.Run("rollback requires rollback_of", func(t *testing.T) {
		_, err := NewDeployment("proj_1", "", "rel_1", DeploymentMetadata{Reason: DeploymentReasonRollback})
		assertDeploymentInvalid(t, err)

		_, err = NewDeployment("proj_1", "", "rel_1", DeploymentMetadata{Reason: DeploymentReasonRollback, RollbackOf: new(" ")})
		assertDeploymentInvalid(t, err)

		entity, err := NewDeployment("proj_1", "", "rel_1", DeploymentMetadata{Reason: DeploymentReasonRollback, RollbackOf: new("dpl_2")})
		require.NoError(t, err)
		assert.Equal(t, "dpl_2", *entity.Metadata.RollbackOf)
	})

	// The field means "the deploy this one reversed", so a non-rollback
	// carrying one is rejected rather than silently dropped.
	t.Run("deploy rejects rollback_of", func(t *testing.T) {
		_, err := NewDeployment("proj_1", "", "rel_1", DeploymentMetadata{Reason: DeploymentReasonDeploy, RollbackOf: new("dpl_2")})
		assertDeploymentInvalid(t, err)
	})

	t.Run("missing release", func(t *testing.T) {
		_, err := NewDeployment("proj_1", "", " ", DeploymentMetadata{Reason: DeploymentReasonDeploy})
		assertDeploymentInvalid(t, err)
	})

	t.Run("unknown reason", func(t *testing.T) {
		_, err := NewDeployment("proj_1", "", "rel_1", DeploymentMetadata{Reason: DeploymentReason(99)})
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
