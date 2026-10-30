package domain

import (
	"slices"
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

	t.Run("the default target is a target like any origin", func(t *testing.T) {
		entity, err := NewDeployment("proj_1", "rel_1", DeploymentOriginKindPrimary, []string{DeploymentTargetDefault, "https://app.acme.com"}, DeploymentMetadata{Reason: DeploymentReasonDeploy})
		require.NoError(t, err)
		assert.Equal(t, []string{DeploymentTargetDefault, "https://app.acme.com"}, entity.Origins())
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

	t.Run("rollback_to is optional and never blank", func(t *testing.T) {
		origins := []string{"https://app.acme.com"}
		_, err := NewDeployment("proj_1", "rel_1", DeploymentOriginKindPrimary, origins, DeploymentMetadata{Reason: DeploymentReasonRollback})
		require.NoError(t, err)

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

func TestDeploymentsEqual(t *testing.T) {
	origins := []string{"https://app.acme.com", "https://www.acme.com"}
	primary, err := NewDeployment("proj_1", "rel_a", DeploymentOriginKindPrimary, origins, DeploymentMetadata{})
	require.NoError(t, err)
	current := *primary
	const setHash = "abc"
	assert.True(t, DeploymentsEqual(primary, &current, setHash, setHash))
	assert.False(t, DeploymentsEqual(primary, nil, setHash, setHash), "nothing deployed yet is a change")
	assert.False(t, DeploymentsEqual(primary, &current, setHash, "other"), "a changed variable set is a new deployment")

	added, err := NewDeployment("proj_1", "rel_a", DeploymentOriginKindPrimary, append(origins, "https://acme.com"), DeploymentMetadata{})
	require.NoError(t, err)
	assert.False(t, DeploymentsEqual(added, &current, setHash, setHash), "a primary origin added since is a change")

	other, err := NewDeployment("proj_1", "rel_b", DeploymentOriginKindPrimary, origins, DeploymentMetadata{})
	require.NoError(t, err)
	assert.False(t, DeploymentsEqual(other, &current, setHash, setHash))

	preview, err := NewDeployment("proj_1", "rel_a", DeploymentOriginKindPreview, origins, DeploymentMetadata{})
	require.NoError(t, err)
	assert.False(t, DeploymentsEqual(preview, &current, setHash, setHash), "a preview deploy renews, so it is always written")
}

func TestErrDeploymentVariablesMissingSortsNames(t *testing.T) {
	err := ErrDeploymentVariablesMissing(DeploymentOriginKindPreview, []string{"GOOGLE_CLIENT_SECRET", "GOOGLE_CLIENT_ID"})
	assert.Equal(t, "dep.variables_missing", err.Code)
	assert.Equal(t, "deployment: the release references variables its kind has no value for", err.Message)
	assert.Equal(t, DeploymentVariablesMissingDetails{
		Kind:  "preview",
		Names: []string{"GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"},
	}, err.Details)
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
	assert.Equal(t, ErrDeploymentInvalid().Code, de.Code)
}

var projectOrigins = []Origin{
	{Pattern: "https://www.acme.com", Kind: OriginKindPrimary},
	{Pattern: "https://app.acme.com", Kind: OriginKindPrimary},
	{Pattern: "https://*-acmeinc.vercel.app", Kind: OriginKindPreview},
}

func TestResolveDeploymentTargets(t *testing.T) {
	t.Run("primary covers every primary origin", func(t *testing.T) {
		kind, origins, err := ResolveDeploymentTargets(projectOrigins, []string{DeploymentTargetPrimary})
		require.NoError(t, err)
		assert.Equal(t, DeploymentOriginKindPrimary, kind)
		assert.Equal(t, []string{"https://www.acme.com", "https://app.acme.com"}, origins)
	})

	t.Run("default alone", func(t *testing.T) {
		kind, origins, err := ResolveDeploymentTargets(nil, []string{DeploymentTargetDefault})
		require.NoError(t, err)
		assert.Equal(t, DeploymentOriginKindPrimary, kind)
		assert.Equal(t, []string{DeploymentTargetDefault}, origins)
	})

	t.Run("default with primary", func(t *testing.T) {
		kind, origins, err := ResolveDeploymentTargets(projectOrigins, []string{DeploymentTargetPrimary, DeploymentTargetDefault})
		require.NoError(t, err)
		assert.Equal(t, DeploymentOriginKindPrimary, kind)
		assert.Equal(t, []string{"https://www.acme.com", "https://app.acme.com", DeploymentTargetDefault}, origins)
	})

	t.Run("default and a preview URL mixed", func(t *testing.T) {
		_, _, err := ResolveDeploymentTargets(projectOrigins, []string{DeploymentTargetDefault, "https://acme-git-sso-acmeinc.vercel.app"})
		assert.ErrorIs(t, err, ErrDeploymentInvalid())
	})

	t.Run("an exact primary origin", func(t *testing.T) {
		_, _, err := ResolveDeploymentTargets(projectOrigins, []string{"https://app.acme.com"})
		assert.ErrorIs(t, err, ErrDeploymentInvalid())
	})

	t.Run("primary with no primary origin", func(t *testing.T) {
		_, _, err := ResolveDeploymentTargets(projectOrigins[2:], []string{DeploymentTargetPrimary})
		assert.ErrorIs(t, err, ErrDeploymentInvalid())
	})

	t.Run("primary and a preview URL mixed", func(t *testing.T) {
		for _, targets := range [][]string{
			{DeploymentTargetPrimary, "https://acme-git-sso-acmeinc.vercel.app"},
			{"https://acme-git-sso-acmeinc.vercel.app", DeploymentTargetPrimary},
		} {
			_, _, err := ResolveDeploymentTargets(projectOrigins, targets)
			assert.ErrorIs(t, err, ErrDeploymentInvalid(), targets)
		}
	})

	t.Run("preview URLs matching a preview pattern", func(t *testing.T) {
		targets := []string{"https://acme-git-sso-acmeinc.vercel.app", "https://acme-k3x9v2-acmeinc.vercel.app"}
		kind, origins, err := ResolveDeploymentTargets(projectOrigins, targets)
		require.NoError(t, err)
		assert.Equal(t, DeploymentOriginKindPreview, kind)
		assert.Equal(t, targets, origins)
	})

	t.Run("a URL no preview pattern matches", func(t *testing.T) {
		for _, target := range []string{"https://acme.example", "https://a.b-acmeinc.vercel.app"} {
			_, _, err := ResolveDeploymentTargets(projectOrigins, []string{"https://acme-git-sso-acmeinc.vercel.app", target})
			require.ErrorIs(t, err, ErrProjectOriginNotAllowed(nil), target)
			assert.Equal(t, map[string]string{"origin": target}, err.(Error).Details)
		}
	})

	t.Run("a loopback URL is never a preview", func(t *testing.T) {
		origins := append(slices.Clone(projectOrigins),
			Origin{Pattern: "http://localhost:3000", Kind: OriginKindPreview},
			Origin{Pattern: "http://127.0.0.1:3000", Kind: OriginKindPreview},
			Origin{Pattern: "http://*.localhost:3000", Kind: OriginKindPreview},
		)
		for _, target := range []string{"http://localhost:3000", "http://127.0.0.1:3000", "http://app.localhost:3000"} {
			_, _, err := ResolveDeploymentTargets(origins, []string{target})
			assert.ErrorIs(t, err, ErrProjectOriginNotAllowed(nil), target)
		}
	})
}

func TestResolvePreviewTTL(t *testing.T) {
	got, err := ResolvePreviewTTL(nil)
	require.NoError(t, err)
	assert.Equal(t, DefaultPreviewTTL, got)

	for _, ttl := range []time.Duration{time.Second, 7 * 24 * time.Hour, MaxPreviewTTL} {
		got, err := ResolvePreviewTTL(&ttl)
		require.NoError(t, err)
		assert.Equal(t, ttl, got)
	}
	for _, ttl := range []time.Duration{0, -time.Hour, MaxPreviewTTL + time.Second} {
		_, err := ResolvePreviewTTL(&ttl)
		assert.ErrorIs(t, err, ErrDeploymentInvalid(), ttl)
	}
	_, err = ResolvePreviewTTL(new(MaxPreviewTTL + time.Second))
	assert.ErrorContains(t, err, "at most 365 days")
}
