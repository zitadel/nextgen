//go:build postgres_integration || spanner_integration || sqlite_integration

package integration_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/httputil"
	"github.com/zitadel/nextgen/internal/service"
	api "go.zitadel.com/zitadel/v5/api"
)

// The origins of the project under test. The app origin is a primary
// origin, so it is an issuer once OAuth is enabled there; the loopback
// origin is primary too, so the release deploys to it; the preview pattern
// is never an issuer.
const (
	oauthAppOrigin      = "https://app.example.com"
	oauthLoopbackOrigin = "http://localhost:3000"
	oauthPreviewPattern = "https://*.preview.example.com"
	oauthPreviewOrigin  = "https://pr-1.preview.example.com"
	// A preview pattern on loopback, as a local preview server would use: a
	// loopback origin it matches is still no issuer.
	oauthLoopbackPreviewPattern = "http://*.localhost:3000"
	oauthLoopbackPreviewOrigin  = "http://pr-1.localhost:3000"
)

// rfc8414Fields are the metadata names RFC 8414 §2 defines (and RFC 8628
// adds device_authorization_endpoint). Every field the server emits must be
// one of them.
var rfc8414Fields = map[string]bool{
	"issuer": true, "authorization_endpoint": true, "token_endpoint": true, "jwks_uri": true,
	"registration_endpoint": true, "scopes_supported": true, "response_types_supported": true,
	"response_modes_supported": true, "grant_types_supported": true,
	"token_endpoint_auth_methods_supported": true, "token_endpoint_auth_signing_alg_values_supported": true,
	"service_documentation": true, "ui_locales_supported": true, "op_policy_uri": true, "op_tos_uri": true,
	"revocation_endpoint": true, "revocation_endpoint_auth_methods_supported": true,
	"revocation_endpoint_auth_signing_alg_values_supported": true, "introspection_endpoint": true,
	"introspection_endpoint_auth_methods_supported":            true,
	"introspection_endpoint_auth_signing_alg_values_supported": true, "code_challenge_methods_supported": true,
	"device_authorization_endpoint": true,
}

// forwarded is the header set of a request that reached the server through
// a proxy at origin: scheme and host from the origin, and prefix when the
// proxy stripped one (the SDK proxy's).
func forwarded(t *testing.T, origin, prefix string) map[string]string {
	t.Helper()
	scheme, host, ok := strings.Cut(origin, "://")
	require.True(t, ok)
	headers := map[string]string{"X-Forwarded-Proto": scheme, "X-Forwarded-Host": host}
	if prefix != "" {
		headers["X-Forwarded-Prefix"] = prefix
	}
	return headers
}

// getMetadata fetches path on the test server with headers and returns the
// response and its body.
func getMetadata(t *testing.T, path string, headers map[string]string) (*http.Response, []byte) {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, harness.EnsureTestServer(t).URL+path, nil)
	require.NoError(t, err)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := harness.EnsureHttpClient(t).Do(req)
	require.NoError(t, err)
	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	require.NoError(t, resp.Body.Close())
	return resp, body
}

// wellKnown is the RFC 8414 §3 URL of the issuer at issuerPath: the
// well-known suffix with the issuer's path appended.
func wellKnown(issuerPath string) string {
	return "/.well-known/oauth-authorization-server" + issuerPath
}

// assertMetadata checks the RFC 8414 document of issuer against what the
// server offers: the required fields, the endpoints on their hosts, only
// RFC 8414 names and no empty values, and the cache headers.
func assertMetadata(t *testing.T, resp *http.Response, body []byte, issuer, backChannel string) {
	t.Helper()
	require.Equal(t, http.StatusOK, resp.StatusCode, string(body))
	assert.Equal(t, "application/json", strings.Split(resp.Header.Get("Content-Type"), ";")[0])
	assert.Equal(t, "no-store", resp.Header.Get("Cache-Control"))
	assert.Contains(t, strings.Join(resp.Header.Values("Vary"), ", "), "X-Forwarded-Host", "a cache keys the document by the forwarded headers")

	var doc map[string]any
	require.NoError(t, json.Unmarshal(body, &doc), string(body))
	assert.Equal(t, issuer, doc["issuer"])
	assert.Equal(t, issuer+"/authorize", doc["authorization_endpoint"])
	assert.Equal(t, backChannel+"/token", doc["token_endpoint"])
	assert.Equal(t, backChannel+"/jwks", doc["jwks_uri"])
	assert.Equal(t, []any{"code"}, doc["response_types_supported"])
	assert.Equal(t, []any{"authorization_code"}, doc["grant_types_supported"])
	assert.Equal(t, []any{"S256"}, doc["code_challenge_methods_supported"])
	for field, value := range doc {
		assert.True(t, rfc8414Fields[field], "field %q is not an RFC 8414 metadata field", field)
		assert.NotEmpty(t, value, "field %q is empty", field)
	}
}

// TestOAuthAuthorizationServerMetadata enables OAuth on a project through a
// release and reads the RFC 8414 document of its issuer: the app origin,
// through the SDK proxy and directly, and a loopback origin. A forged host,
// a preview host and the server's own host are no issuer; a project whose
// deployed release does not enable OAuth has none either.
func TestOAuthAuthorizationServerMetadata(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), []domain.Origin{
		{Pattern: oauthAppOrigin, Kind: domain.OriginKindPrimary},
		{Pattern: oauthLoopbackOrigin, Kind: domain.OriginKindPrimary},
		{Pattern: oauthPreviewPattern, Kind: domain.OriginKindPreview},
		{Pattern: oauthLoopbackPreviewPattern, Kind: domain.OriginKindPreview},
	}, false)
	require.NoError(t, err)
	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)
	params := api.BuildReleaseParams{ProjectID: api.ProjectID(project.ID)}
	issuerPath := "/oauth/" + project.ID
	backChannel := helpers.ConsoleOrigin + issuerPath

	// Nothing is deployed yet: the issuer does not exist.
	resp, body := getMetadata(t, wellKnown(issuerPath), forwarded(t, oauthAppOrigin, httputil.ProxyPrefix))
	assert.Equal(t, http.StatusNotFound, resp.StatusCode, string(body))
	assert.Equal(t, "no-store", resp.Header.Get("Cache-Control"), "a 404 is not cached either")

	// Building a release with oauth pins a revision, and the revision reads
	// back.
	built, err := client.BuildRelease(t.Context(), &api.BuildReleaseRequest{
		Bundle:  api.ConfigurationBundle{OAuth: api.NewOptOAuthSettings(api.OAuthSettings{Enabled: true})},
		Message: api.NewOptString("enable oauth"),
	}, params)
	require.NoError(t, err)
	require.IsType(t, &api.BuildReleaseCreated{}, built, helpers.MustMarshal(t, built))
	release := api.Release(*built.(*api.BuildReleaseCreated))
	require.Len(t, release.Pointers, 1)
	assert.Equal(t, api.ReleasePointerKindOAuth, release.Pointers[0].Kind)
	assert.Equal(t, domain.ReleaseOAuthHandle, release.Pointers[0].Handle)
	revisionID := release.Pointers[0].RevisionID
	assert.True(t, domain.PrefixOAuthSettings.Matches(revisionID), revisionID)

	read, err := client.GetOAuthSettingsById(t.Context(), api.GetOAuthSettingsByIdParams{OAuthSettingsID: revisionID})
	require.NoError(t, err)
	require.IsType(t, &api.OAuthSettingsRevisionResponse{}, read, helpers.MustMarshal(t, read))
	revision := read.(*api.OAuthSettingsRevisionResponse)
	assert.Equal(t, revisionID, revision.ID)
	assert.True(t, revision.OAuth.Enabled)

	// The same bundle again reuses the revision and the release.
	again, err := client.BuildRelease(t.Context(), &api.BuildReleaseRequest{
		Bundle: api.ConfigurationBundle{OAuth: api.NewOptOAuthSettings(api.OAuthSettings{Enabled: true})},
	}, params)
	require.NoError(t, err)
	require.IsType(t, &api.BuildReleaseOK{}, again, helpers.MustMarshal(t, again))
	assert.Equal(t, release.ID, api.Release(*again.(*api.BuildReleaseOK)).ID)

	// A revision of another project is not readable through this one.
	other, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, false)
	require.NoError(t, err)
	foreign, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, foreign, other)
	denied, err := foreign.GetOAuthSettingsById(t.Context(), api.GetOAuthSettingsByIdParams{OAuthSettingsID: revisionID})
	require.NoError(t, err)
	require.IsType(t, &api.ErrorDetails{}, denied, helpers.MustMarshal(t, denied))
	assert.Equal(t, api.ErrorCode(domain.ErrOAuthSettingsNotFound().Code), denied.(*api.ErrorDetails).Code)

	// Deploying the release to the primary origins turns the issuers on.
	_, err = harness.EnsureDeploymentService(t).Deploy(t.Context(), service.DeployInput{
		ProjectID: project.ID,
		ReleaseID: string(release.ID),
		To:        domain.DeployToPrimary(),
		Reason:    domain.DeploymentReasonDeploy,
	})
	require.NoError(t, err)

	t.Run("through the SDK proxy", func(t *testing.T) {
		resp, body := getMetadata(t, wellKnown(issuerPath), forwarded(t, oauthAppOrigin, httputil.ProxyPrefix))
		assertMetadata(t, resp, body, oauthAppOrigin+httputil.ProxyPrefix+issuerPath, backChannel)
	})

	t.Run("directly", func(t *testing.T) {
		resp, body := getMetadata(t, wellKnown(issuerPath), forwarded(t, oauthAppOrigin, ""))
		assertMetadata(t, resp, body, oauthAppOrigin+issuerPath, backChannel)
	})

	t.Run("loopback", func(t *testing.T) {
		resp, body := getMetadata(t, wellKnown(issuerPath), forwarded(t, oauthLoopbackOrigin, ""))
		assertMetadata(t, resp, body, oauthLoopbackOrigin+issuerPath, backChannel)
	})

	t.Run("no issuer", func(t *testing.T) {
		for name, headers := range map[string]map[string]string{
			"forged host":           forwarded(t, "https://evil.example.com", httputil.ProxyPrefix),
			"preview host":          forwarded(t, oauthPreviewOrigin, httputil.ProxyPrefix),
			"the server's own host": forwarded(t, helpers.ConsoleOrigin, ""),
			"forged prefix":         forwarded(t, oauthAppOrigin, "/evil"),
		} {
			resp, body := getMetadata(t, wellKnown(issuerPath), headers)
			assert.Equal(t, http.StatusNotFound, resp.StatusCode, "%s: %s", name, body)
			assert.Equal(t, "no-store", resp.Header.Get("Cache-Control"), name)
		}
	})

	t.Run("a loopback origin under a preview pattern is no issuer", func(t *testing.T) {
		// A preview deployment never targets a loopback URL, so no live
		// preview can exist there; the admission refuses the origin on the
		// pattern alone (internal/oauth covers a live one).
		resp, body := getMetadata(t, wellKnown(issuerPath), forwarded(t, oauthLoopbackPreviewOrigin, ""))
		assert.Equal(t, http.StatusNotFound, resp.StatusCode, string(body))
	})

	t.Run("openid configuration is not served", func(t *testing.T) {
		resp, body := getMetadata(t, issuerPath+"/.well-known/openid-configuration", forwarded(t, oauthAppOrigin, httputil.ProxyPrefix))
		assert.Equal(t, http.StatusNotFound, resp.StatusCode, string(body))
	})

	t.Run("a release that does not enable oauth", func(t *testing.T) {
		quiet, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), []domain.Origin{
			{Pattern: oauthAppOrigin, Kind: domain.OriginKindPrimary},
		}, false)
		require.NoError(t, err)
		deployBundle(t, quiet.ID, service.BuildReleaseInput{
			ProjectID: quiet.ID,
			Branding:  &service.CreateBrandingInput{ProjectID: quiet.ID, Layout: domain.BrandingLayoutCentered},
		})
		resp, body := getMetadata(t, wellKnown("/oauth/"+quiet.ID), forwarded(t, oauthAppOrigin, httputil.ProxyPrefix))
		assert.Equal(t, http.StatusNotFound, resp.StatusCode, "without oauth in the release: %s", body)

		deployBundle(t, quiet.ID, service.BuildReleaseInput{
			ProjectID: quiet.ID,
			OAuth:     &service.CreateOAuthSettingsInput{ProjectID: quiet.ID, Enabled: false},
		})
		resp, body = getMetadata(t, wellKnown("/oauth/"+quiet.ID), forwarded(t, oauthAppOrigin, httputil.ProxyPrefix))
		assert.Equal(t, http.StatusNotFound, resp.StatusCode, "with oauth disabled: %s", body)
	})
}

// TestOAuthPlatformIssuerMetadata reads the platform project's issuer, the
// empty tenant at the server's public base: no document while its release
// has no oauth, the document once it does. The platform project is outside
// any test's own project, so this test removes it (internal/AGENTS.md); it
// is not parallel because another test bootstraps the same project.
func TestOAuthPlatformIssuerMetadata(t *testing.T) {
	projects := harness.EnsureProjectService(t)
	_, err := projects.CreateWithID(t.Context(), domain.PlatformProjectID, "Platform", []domain.Origin{
		{Pattern: helpers.ConsoleOrigin, Kind: domain.OriginKindPrimary},
	}, false)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = harness.EnsureServiceDB(t).Statements().DeleteProjectByID(context.Background(), domain.PlatformProjectID)
	})
	headers := forwarded(t, helpers.ConsoleOrigin, "")

	resp, body := getMetadata(t, wellKnown("/oauth"), headers)
	assert.Equal(t, http.StatusNotFound, resp.StatusCode, "nothing deployed: %s", body)

	deployBundle(t, domain.PlatformProjectID, service.BuildReleaseInput{
		ProjectID: domain.PlatformProjectID,
		Branding:  &service.CreateBrandingInput{ProjectID: domain.PlatformProjectID, Layout: domain.BrandingLayoutCentered},
	})
	resp, body = getMetadata(t, wellKnown("/oauth"), headers)
	assert.Equal(t, http.StatusNotFound, resp.StatusCode, "release without oauth: %s", body)

	deployBundle(t, domain.PlatformProjectID, service.BuildReleaseInput{
		ProjectID: domain.PlatformProjectID,
		OAuth:     &service.CreateOAuthSettingsInput{ProjectID: domain.PlatformProjectID, Enabled: true},
	})
	resp, body = getMetadata(t, wellKnown("/oauth"), headers)
	assertMetadata(t, resp, body, helpers.ConsoleOrigin+"/oauth", helpers.ConsoleOrigin+"/oauth")

	// The platform issuer is reached directly, never through an app's proxy.
	resp, body = getMetadata(t, wellKnown("/oauth"), forwarded(t, helpers.ConsoleOrigin, httputil.ProxyPrefix))
	assert.Equal(t, http.StatusNotFound, resp.StatusCode, string(body))
	// The platform project's own id is no tenant: its issuer is the prefix.
	resp, body = getMetadata(t, wellKnown("/oauth/"+domain.PlatformProjectID), headers)
	assert.Equal(t, http.StatusNotFound, resp.StatusCode, string(body))
}

// deployBundle builds a release from bundle and deploys it to the project's
// primary origins.
func deployBundle(t *testing.T, projectID string, bundle service.BuildReleaseInput) {
	t.Helper()
	built, err := harness.EnsureReleaseService(t).Build(t.Context(), bundle)
	require.NoError(t, err)
	_, err = harness.EnsureDeploymentService(t).Deploy(t.Context(), service.DeployInput{
		ProjectID: projectID,
		ReleaseID: built.Release.ID,
		To:        domain.DeployToPrimary(),
		Reason:    domain.DeploymentReasonDeploy,
	})
	require.NoError(t, err)
}
