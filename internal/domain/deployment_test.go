package domain

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewDeploymentValidates(t *testing.T) {
	t.Run("deploy", func(t *testing.T) {
		entity, err := NewDeployment("proj_1", "rel_1", DeploymentOriginKindPrimary, []string{"https://app.acme.com"}, DeploymentMetadata{Reason: DeploymentReasonDeploy})
		require.NoError(t, err)
		assert.Empty(t, entity.ID, "the id is the dialect's to mint")
		assert.True(t, entity.DeployedAt.IsZero(), "deployed_at is the insert's to stamp")
		assert.Equal(t, []string{"https://app.acme.com"}, entity.Origins())
	})

	t.Run("targets are sorted and deduplicated", func(t *testing.T) {
		origins := []string{"https://www.acme.com", "https://app.acme.com", "https://www.acme.com"}
		entity, err := NewDeployment("proj_1", "rel_1", DeploymentOriginKindPrimary, origins, DeploymentMetadata{})
		require.NoError(t, err)
		assert.Equal(t, []string{"https://app.acme.com", "https://www.acme.com"}, entity.Origins())
		assert.Equal(t, "https://www.acme.com", origins[0], "the caller's slice is not reordered")
	})

	t.Run("targets are required and bounded", func(t *testing.T) {
		_, err := NewDeployment("proj_1", "rel_1", DeploymentOriginKindPrimary, nil, DeploymentMetadata{})
		assertDeploymentInvalid(t, err)

		_, err = NewDeployment("proj_1", "rel_1", DeploymentOriginKindPrimary, []string{" "}, DeploymentMetadata{})
		assertDeploymentInvalid(t, err)

		many := make([]string, MaxDeploymentTargets+1)
		for i := range many {
			many[i] = "https://" + string(rune('a'+i%26)) + string(rune('a'+i/26)) + ".acme.com"
		}
		_, err = NewDeployment("proj_1", "rel_1", DeploymentOriginKindPrimary, many, DeploymentMetadata{})
		assertDeploymentInvalid(t, err)

		_, err = NewDeployment("proj_1", "rel_1", DeploymentOriginKindPrimary, many[:MaxDeploymentTargets], DeploymentMetadata{})
		require.NoError(t, err)
	})

	t.Run("rollback requires rollback_to", func(t *testing.T) {
		origins := []string{"https://app.acme.com"}
		_, err := NewDeployment("proj_1", "rel_1", DeploymentOriginKindPrimary, origins, DeploymentMetadata{Reason: DeploymentReasonRollback})
		assertDeploymentInvalid(t, err)

		_, err = NewDeployment("proj_1", "rel_1", DeploymentOriginKindPrimary, origins, DeploymentMetadata{Reason: DeploymentReasonRollback, RollbackTo: new(" ")})
		assertDeploymentInvalid(t, err)

		entity, err := NewDeployment("proj_1", "rel_1", DeploymentOriginKindPrimary, origins, DeploymentMetadata{Reason: DeploymentReasonRollback, RollbackTo: new("dep_1")})
		require.NoError(t, err)
		assert.Equal(t, "dep_1", *entity.Metadata.RollbackTo)
	})

	// The field means "what a rollback re-applied", so a plain deploy carrying
	// one is rejected rather than silently dropped.
	t.Run("deploy rejects rollback_to", func(t *testing.T) {
		_, err := NewDeployment("proj_1", "rel_1", DeploymentOriginKindPrimary, []string{"https://app.acme.com"}, DeploymentMetadata{RollbackTo: new("dep_1")})
		assertDeploymentInvalid(t, err)
	})

	t.Run("missing release", func(t *testing.T) {
		_, err := NewDeployment("proj_1", " ", DeploymentOriginKindPrimary, []string{"https://app.acme.com"}, DeploymentMetadata{})
		assertDeploymentInvalid(t, err)
	})

	t.Run("unknown reason or kind", func(t *testing.T) {
		origins := []string{"https://app.acme.com"}
		_, err := NewDeployment("proj_1", "rel_1", DeploymentOriginKindPrimary, origins, DeploymentMetadata{Reason: DeploymentReason(99)})
		assertDeploymentInvalid(t, err)

		_, err = NewDeployment("proj_1", "rel_1", DeploymentOriginKind(99), origins, DeploymentMetadata{})
		assertDeploymentInvalid(t, err)
	})
}

var t0 = time.Date(2026, 10, 2, 14, 52, 0, 0, time.UTC)

func TestNewestOriginDeploymentBreaksTiesOnID(t *testing.T) {
	assert.Nil(t, NewestOriginDeployment(nil))
	newest := NewestOriginDeployment([]OriginDeployment{
		{DeploymentID: "dep_a", DeployedAt: t0},
		{DeploymentID: "dep_c", DeployedAt: t0.Add(-time.Second)},
		{DeploymentID: "dep_b", DeployedAt: t0},
	})
	assert.Equal(t, "dep_b", newest.DeploymentID)
}

func TestDeploymentUnchanged(t *testing.T) {
	origins := []string{"https://app.acme.com", "https://www.acme.com"}
	serving := []OriginDeployment{
		{Origin: "https://app.acme.com", ReleaseID: "rel_a", Kind: DeploymentOriginKindPrimary},
		{Origin: "https://www.acme.com", ReleaseID: "rel_a", Kind: DeploymentOriginKindPrimary},
	}
	primary, err := NewDeployment("proj_1", "rel_a", DeploymentOriginKindPrimary, origins, DeploymentMetadata{})
	require.NoError(t, err)
	assert.True(t, primary.Unchanged(serving))
	assert.False(t, primary.Unchanged(serving[:1]), "an origin serving nothing is a change")

	// An origin last served as a preview becomes a primary origin: that is a
	// change, or its row would still expire with the preview.
	fromPreview := []OriginDeployment{serving[0], {Origin: "https://www.acme.com", ReleaseID: "rel_a", Kind: DeploymentOriginKindPreview}}
	assert.False(t, primary.Unchanged(fromPreview))

	other, err := NewDeployment("proj_1", "rel_b", DeploymentOriginKindPrimary, origins, DeploymentMetadata{})
	require.NoError(t, err)
	assert.False(t, other.Unchanged(serving))

	preview, err := NewDeployment("proj_1", "rel_a", DeploymentOriginKindPreview, origins, DeploymentMetadata{})
	require.NoError(t, err)
	assert.False(t, preview.Unchanged(serving), "a preview deploy renews, so it is always written")
}

func TestCheckExpectedDeployment(t *testing.T) {
	current := &Deployment{ID: "dep_1"}
	assert.NoError(t, CheckExpectedDeployment(current, nil))
	assert.NoError(t, CheckExpectedDeployment(current, new("dep_1")))
	assert.NoError(t, CheckExpectedDeployment(nil, nil))

	err := CheckExpectedDeployment(current, new("dep_0"))
	require.Error(t, err)
	assert.Equal(t, DeploymentConflictDetails{Deployment: current}, err.(Error).Details)

	err = CheckExpectedDeployment(nil, new("dep_0"))
	require.Error(t, err)
	assert.Equal(t, DeploymentConflictDetails{}, err.(Error).Details)
}

func assertDeploymentInvalid(t *testing.T, err error) {
	t.Helper()
	require.Error(t, err)
	de, ok := err.(Error)
	require.True(t, ok, "expected a domain error, got %T", err)
	assert.Equal(t, ErrDeploymentInvalid(nil, nil).Code, de.Code)
}
