package oauth

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// runtime is a fake runtimeResolver that records how it was asked.
type runtime struct {
	resolution *service.RuntimeResolution
	err        error
	resolved   []string // "project|origin"; "" origin for ResolvePrimary
}

func (r *runtime) Resolve(_ context.Context, projectID, origin string) (*service.RuntimeResolution, error) {
	r.resolved = append(r.resolved, projectID+"|"+origin)
	return r.resolution, r.err
}

func (r *runtime) ResolvePrimary(_ context.Context, projectID string) (*service.RuntimeResolution, error) {
	r.resolved = append(r.resolved, projectID+"|")
	return r.resolution, r.err
}

// revisions is a fake service.OAuthSettingsReader.
type revisions map[string]*domain.OAuthSettings

func (r revisions) Get(_ context.Context, _, id string) (*domain.OAuthSettings, error) {
	if s, ok := r[id]; ok {
		return s, nil
	}
	return nil, domain.ErrOAuthSettingsNotFound()
}

// releaseWith is a resolution from a primary deployment to the customer
// issuer's origin that serves a release pinning pointers.
func releaseWith(pointers ...domain.ReleasePointer) *service.RuntimeResolution {
	return &service.RuntimeResolution{
		Origin:     "https://app.example.com",
		Target:     "https://app.example.com",
		Source:     "origin",
		Deployment: &domain.Deployment{ID: "dep_1", OriginKind: domain.DeploymentOriginKindPrimary},
		Release:    &domain.Release{ID: "rel_1", Pointers: pointers},
	}
}

func oauthPin(revisionID string) domain.ReleasePointer {
	return domain.ReleasePointer{Kind: domain.ReleasePointerKindOauth, Handle: domain.ReleaseOAuthHandle, RevisionID: revisionID}
}

func customerIssuer(t *testing.T) Issuer {
	t.Helper()
	return Issuer{ProjectID: "proj_app", URL: mustParseURL(t, "https://app.example.com/__nextgen/oauth/proj_app")}
}

func TestReleaseSettingsReadsThePinnedRevision(t *testing.T) {
	t.Parallel()
	rt := &runtime{resolution: releaseWith(oauthPin("oauthset_on"))}
	source := NewReleaseSettings(rt, revisions{"oauthset_on": {ID: "oauthset_on", Enabled: true}})

	got, err := source.Get(t.Context(), customerIssuer(t))
	require.NoError(t, err)
	assert.Equal(t, Settings{Enabled: true}, got)
	assert.Equal(t, []string{"proj_app|https://app.example.com"}, rt.resolved, "the deployment to the issuer's origin decides")
}

func TestReleaseSettingsPlatformUsesThePrimaryDeployment(t *testing.T) {
	t.Parallel()
	rt := &runtime{resolution: releaseWith(oauthPin("oauthset_on"))}
	source := NewReleaseSettings(rt, revisions{"oauthset_on": {ID: "oauthset_on", Enabled: true}})

	got, err := source.Get(t.Context(), Issuer{ProjectID: domain.PlatformProjectID, Platform: true, URL: mustParseURL(t, "https://api.example.com/oauth")})
	require.NoError(t, err)
	assert.True(t, got.Enabled)
	assert.Equal(t, []string{domain.PlatformProjectID + "|"}, rt.resolved)
}

func TestReleaseSettingsOff(t *testing.T) {
	t.Parallel()
	for _, tt := range []struct {
		name string
		rt   *runtime
	}{
		{name: "release without oauth", rt: &runtime{resolution: releaseWith(
			domain.ReleasePointer{Kind: domain.ReleasePointerKindBranding, Handle: domain.ReleaseBrandingHandle, RevisionID: "brnd_1"})}},
		{name: "oauth disabled", rt: &runtime{resolution: releaseWith(oauthPin("oauthset_off"))}},
		{name: "nothing deployed to the origin", rt: &runtime{err: domain.ErrReleaseNotDeployed(nil)}},
		{name: "no primary deployment", rt: &runtime{err: domain.ErrReleaseNoDefault()}},
		{name: "revoked release", rt: &runtime{err: domain.ErrReleaseRevoked()}},
		{name: "origin not listed", rt: &runtime{err: domain.ErrProjectOriginNotAllowed(nil)}},
		{name: "unknown project", rt: &runtime{err: domain.ErrProjectNotFound()}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			source := NewReleaseSettings(tt.rt, revisions{"oauthset_off": {ID: "oauthset_off"}})
			got, err := source.Get(t.Context(), customerIssuer(t))
			require.NoError(t, err)
			assert.False(t, got.Enabled)
		})
	}
}

// A resolution that is not a primary deployment to the issuer's own origin
// leaves the issuer off, however the release enables OAuth: the newest
// primary deployment the resolver serves to the console's own origin, and
// a preview deployment to a preview origin, make no issuer.
func TestReleaseSettingsOffUnlessDeployedToTheIssuer(t *testing.T) {
	t.Parallel()
	defaultServed := releaseWith(oauthPin("oauthset_on"))
	defaultServed.Source = "default"
	defaultServed.Target = ""
	preview := releaseWith(oauthPin("oauthset_on"))
	preview.Target = "https://*.preview.example.com"
	preview.Deployment = &domain.Deployment{ID: "dep_preview", OriginKind: domain.DeploymentOriginKindPreview}
	elsewhere := releaseWith(oauthPin("oauthset_on"))
	elsewhere.Origin = "https://other.example.com"
	for _, tt := range []struct {
		name       string
		resolution *service.RuntimeResolution
	}{
		{name: "default served to an own origin", resolution: defaultServed},
		{name: "preview deployment", resolution: preview},
		{name: "deployment to another origin", resolution: elsewhere},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			source := NewReleaseSettings(&runtime{resolution: tt.resolution}, revisions{"oauthset_on": {ID: "oauthset_on", Enabled: true}})
			got, err := source.Get(t.Context(), customerIssuer(t))
			require.NoError(t, err)
			assert.False(t, got.Enabled)
		})
	}

	// The platform issuer is the one served by the default, as its own origin.
	platform := NewReleaseSettings(&runtime{resolution: defaultServed}, revisions{"oauthset_on": {ID: "oauthset_on", Enabled: true}})
	got, err := platform.Get(t.Context(), Issuer{ProjectID: domain.PlatformProjectID, Platform: true, URL: mustParseURL(t, "https://api.example.com/oauth")})
	require.NoError(t, err)
	assert.True(t, got.Enabled)
}

func TestReleaseSettingsFaults(t *testing.T) {
	t.Parallel()

	t.Run("resolver fault", func(t *testing.T) {
		t.Parallel()
		source := NewReleaseSettings(&runtime{err: domain.ErrInternal(errors.New("db down"))}, revisions{})
		_, err := source.Get(t.Context(), customerIssuer(t))
		assert.True(t, domain.IsServerFault(err))
	})

	t.Run("unclassified resolver error", func(t *testing.T) {
		t.Parallel()
		source := NewReleaseSettings(&runtime{err: errors.New("connection reset")}, revisions{})
		_, err := source.Get(t.Context(), customerIssuer(t))
		assert.True(t, domain.IsServerFault(err))
	})

	t.Run("pinned revision missing", func(t *testing.T) {
		t.Parallel()
		source := NewReleaseSettings(&runtime{resolution: releaseWith(oauthPin("oauthset_gone"))}, revisions{})
		_, err := source.Get(t.Context(), customerIssuer(t))
		assert.True(t, domain.IsServerFault(err))
	})
}
