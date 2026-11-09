package domain_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestNewOAuthSettings(t *testing.T) {
	t.Parallel()

	settings, err := domain.NewOAuthSettings("proj_1", true)
	require.NoError(t, err)
	assert.Equal(t, "proj_1", settings.ProjectID)
	assert.True(t, settings.Enabled)
	assert.Empty(t, settings.ID, "the dialect mints the id on insert")
	assert.False(t, settings.CreatedAt.IsZero())

	_, err = domain.NewOAuthSettings("", true)
	assert.ErrorIs(t, err, domain.ErrOAuthSettingsMissingProjectID())
}

func TestValidateOAuthSettings(t *testing.T) {
	t.Parallel()

	assert.ErrorIs(t, domain.ValidateOAuthSettings(nil), domain.ErrOAuthSettingsInvalid(nil, nil))
	assert.ErrorIs(t, domain.ValidateOAuthSettings(&domain.OAuthSettings{}), domain.ErrOAuthSettingsMissingProjectID())
	assert.NoError(t, domain.ValidateOAuthSettings(&domain.OAuthSettings{ProjectID: "proj_1"}))
}

// Equal compares the author-facing content only, so a release build reuses
// a revision of another id and age that says the same thing.
func TestOAuthSettingsEqual(t *testing.T) {
	t.Parallel()

	on := &domain.OAuthSettings{ProjectID: "proj_1", ID: "oauthset_1", Enabled: true}
	onAgain := &domain.OAuthSettings{ProjectID: "proj_2", ID: "oauthset_2", Enabled: true}
	off := &domain.OAuthSettings{ProjectID: "proj_1", ID: "oauthset_3"}

	assert.True(t, on.Equal(onAgain))
	assert.False(t, on.Equal(off))
	assert.False(t, on.Equal(nil))
	var none *domain.OAuthSettings
	assert.True(t, none.Equal(nil))
}

// A release pins OAuth settings under the constant handle, so two revisions
// in one release collide on it.
func TestReleaseContentPointersOAuth(t *testing.T) {
	t.Parallel()

	pointers, err := domain.ReleaseContent{OAuth: &domain.OAuthSettings{ID: "oauthset_1"}}.Pointers()
	require.NoError(t, err)
	assert.Equal(t, []domain.ReleasePointer{{
		Kind:       domain.ReleasePointerKindOauth,
		Handle:     domain.ReleaseOAuthHandle,
		RevisionID: "oauthset_1",
	}}, pointers)
	assert.Equal(t, "oauth", domain.ReleasePointerKindOauth.String(), "the wire value of the kind")

	_, err = domain.ReleaseContent{OAuth: &domain.OAuthSettings{}}.Pointers()
	assert.ErrorIs(t, err, domain.ErrReleaseInvalid(nil, nil), "a revision without an id is unpinnable")
}

// The oauth singleton counts as a resource: a bundle holding only it is not
// empty.
func TestBundleShapeCountsOAuth(t *testing.T) {
	t.Parallel()

	assert.True(t, domain.BundleEmpty(domain.BundleShapeInput{}))
	assert.False(t, domain.BundleEmpty(domain.BundleShapeInput{HasOAuth: true}))
	assert.Empty(t, domain.ValidateBundleShape(domain.BundleShapeInput{HasOAuth: true}))
}
