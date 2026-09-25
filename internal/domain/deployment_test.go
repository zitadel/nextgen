package domain

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewDeploymentValidates(t *testing.T) {
	t.Run("deploy", func(t *testing.T) {
		entity, err := NewDeployment("proj_1", "env_1", "rel_1", DeploymentMetadata{Reason: DeploymentReasonDeploy, SourceEnvironmentID: nil})
		require.NoError(t, err)
		assert.Empty(t, entity.ID, "the id is the dialect's to mint")
		assert.True(t, entity.DeployedAt.IsZero(), "deployed_at is the insert's to stamp")
	})

	t.Run("promote requires a source", func(t *testing.T) {
		_, err := NewDeployment("proj_1", "env_1", "rel_1", DeploymentMetadata{Reason: DeploymentReasonPromote, SourceEnvironmentID: nil})
		assertDeploymentInvalid(t, err)

		_, err = NewDeployment("proj_1", "env_1", "rel_1", DeploymentMetadata{Reason: DeploymentReasonPromote, SourceEnvironmentID: new(" ")})
		assertDeploymentInvalid(t, err)

		entity, err := NewDeployment("proj_1", "env_1", "rel_1", DeploymentMetadata{Reason: DeploymentReasonPromote, SourceEnvironmentID: new("env_2")})
		require.NoError(t, err)
		assert.Equal(t, "env_2", *entity.Metadata.SourceEnvironmentID)
	})

	// The field means "where it was promoted from", so a non-promotion
	// carrying one is rejected rather than silently dropped.
	t.Run("deploy and rollback reject a source", func(t *testing.T) {
		_, err := NewDeployment("proj_1", "env_1", "rel_1", DeploymentMetadata{Reason: DeploymentReasonDeploy, SourceEnvironmentID: new("env_2")})
		assertDeploymentInvalid(t, err)

		_, err = NewDeployment("proj_1", "env_1", "rel_1", DeploymentMetadata{Reason: DeploymentReasonRollback, SourceEnvironmentID: new("env_2")})
		assertDeploymentInvalid(t, err)
	})

	t.Run("missing references", func(t *testing.T) {
		_, err := NewDeployment("proj_1", "", "rel_1", DeploymentMetadata{Reason: DeploymentReasonDeploy, SourceEnvironmentID: nil})
		assertDeploymentInvalid(t, err)

		_, err = NewDeployment("proj_1", "env_1", " ", DeploymentMetadata{Reason: DeploymentReasonDeploy, SourceEnvironmentID: nil})
		assertDeploymentInvalid(t, err)
	})

	t.Run("unknown reason", func(t *testing.T) {
		_, err := NewDeployment("proj_1", "env_1", "rel_1", DeploymentMetadata{Reason: DeploymentReason(99), SourceEnvironmentID: nil})
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
