//go:build postgres_integration || spanner_integration || sqlite_integration

package integration_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/go-jose/go-jose/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/oidc/v3/pkg/oidc"

	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// TestOAuthToken exchanges a code at the token endpoint of a project whose
// deployed release enables OAuth. No HTTP path issues a code yet, so the test
// issues it through the service. What the redemption checks on the database
// is oauth_code_test.go's to assert: this test covers the client's
// authentication and the endpoint's answers.
func TestOAuthToken(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), []domain.Origin{
		{Pattern: oauthAppOrigin, Kind: domain.OriginKindPrimary},
	}, true)
	require.NoError(t, err)
	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)
	web := applicationFixture{project: project, client: client}.create(t, shopApplication(webClient("web", ""))).ClientSecrets[0]
	deployBundle(t, project.ID, service.BuildReleaseInput{
		ProjectID: project.ID,
		OAuth:     &service.CreateOAuthSettingsInput{ProjectID: project.ID, Enabled: true},
	})
	requests := service.NewAuthRequestService(harness.EnsureServiceDB(t), harness.EnsureKeyService(t))

	const (
		redirectURI = "https://web.example.com/callback"
		verifier    = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
	)

	// issue starts a sign-in at the authorization endpoint, with PKCE when
	// pkce is set, and gives the stored request a code for a new user.
	issue := func(t *testing.T, pkce bool) (code, userID string) {
		t.Helper()
		query := url.Values{
			"client_id":     {web.ClientID},
			"redirect_uri":  {redirectURI},
			"response_type": {"code"},
			"state":         {"xyz"},
		}
		if pkce {
			query.Set("code_challenge", oidc.NewSHACodeChallenge(verifier))
			query.Set("code_challenge_method", "S256")
		}
		req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, harness.EnsureTestServer(t).URL+"/oauth/"+project.ID+"/authorize?"+query.Encode(), nil)
		require.NoError(t, err)
		for k, v := range forwarded(t, oauthAppOrigin, "") {
			req.Header.Set(k, v)
		}
		//egress:allow integration-test harness talking to the server under test
		resp, err := (&http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}).Do(req)
		require.NoError(t, err)
		require.NoError(t, resp.Body.Close())
		require.Equal(t, http.StatusFound, resp.StatusCode)
		location, err := resp.Location()
		require.NoError(t, err)

		userID = harness.CreateUserWithTeam(t, project.ID)
		session := harness.CreateActiveSession(t, project.ID, userID)
		code, err = requests.IssueCode(t.Context(), project.ID, location.Query().Get("auth_request"), userID, session.ID)
		require.NoError(t, err)
		return code, userID
	}
	// exchange posts form to the token endpoint, as the client's backend
	// does, with HTTP Basic authentication when basic is set.
	exchange := func(t *testing.T, form url.Values, basic bool, secret string) (*http.Response, map[string]any) {
		t.Helper()
		form.Set("grant_type", "authorization_code")
		if !basic {
			form.Set("client_id", web.ClientID)
			form.Set("client_secret", secret)
		}
		req, err := http.NewRequestWithContext(t.Context(), http.MethodPost, harness.EnsureTestServer(t).URL+"/oauth/"+project.ID+"/token", strings.NewReader(form.Encode()))
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		if basic {
			req.SetBasicAuth(url.QueryEscape(web.ClientID), url.QueryEscape(secret))
		}
		//egress:allow integration-test harness talking to the server under test
		resp, err := http.DefaultClient.Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()
		raw, err := io.ReadAll(resp.Body)
		require.NoError(t, err)
		var body map[string]any
		require.NoError(t, json.Unmarshal(raw, &body), string(raw))
		return resp, body
	}

	for _, tc := range []struct {
		name  string
		pkce  bool
		basic bool
	}{
		{name: "with PKCE and client_secret_basic", pkce: true, basic: true},
		{name: "without PKCE and client_secret_post"},
	} {
		t.Run("a code is exchanged "+tc.name, func(t *testing.T) {
			code, userID := issue(t, tc.pkce)
			form := url.Values{"code": {code}, "redirect_uri": {redirectURI}}
			if tc.pkce {
				form.Set("code_verifier", verifier)
			}

			resp, body := exchange(t, form, tc.basic, web.Secret)

			require.Equal(t, http.StatusOK, resp.StatusCode, body)
			assert.Equal(t, "no-store", resp.Header.Get("Cache-Control"))
			token, ok := body["access_token"].(string)
			require.True(t, ok, body)
			delete(body, "access_token")
			assert.Equal(t, map[string]any{"token_type": "Bearer", "expires_in": float64(300)}, body, "no scope, refresh_token or id_token")

			key, err := harness.EnsureKeyService(t).GetProjectSigningKey(t.Context(), project.ID, domain.SigningKeyPurposeToken)
			require.NoError(t, err)
			parsed, err := jose.ParseSigned(token, []jose.SignatureAlgorithm{jose.EdDSA})
			require.NoError(t, err)
			payload, err := parsed.Verify(signingPublicKey(t, key))
			require.NoError(t, err)
			var claims map[string]any
			require.NoError(t, json.Unmarshal(payload, &claims))
			assert.Equal(t, oauthAppOrigin+"/oauth/"+project.ID, claims["iss"])
			assert.Equal(t, userID, claims["sub"])
			assert.Equal(t, []any{web.ClientID}, claims["aud"])
			assert.Equal(t, web.ClientID, claims["client_id"])
		})
	}

	t.Run("a wrong secret is refused without using up the code", func(t *testing.T) {
		code, _ := issue(t, false)

		resp, body := exchange(t, url.Values{"code": {code}, "redirect_uri": {redirectURI}}, true, "wrong")

		assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
		assert.Equal(t, "invalid_client", body["error"])
		assert.Equal(t, `Basic realm="oauth"`, resp.Header.Get("WWW-Authenticate"))

		resp, body = exchange(t, url.Values{"code": {code}, "redirect_uri": {redirectURI}}, true, web.Secret)
		assert.Equal(t, http.StatusOK, resp.StatusCode, body)
	})

	for _, tc := range []struct {
		name string
		form url.Values
	}{
		{name: "a missing code_verifier", form: url.Values{"redirect_uri": {redirectURI}}},
		{name: "a wrong code_verifier", form: url.Values{"redirect_uri": {redirectURI}, "code_verifier": {verifier + "x"}}},
		{name: "a wrong redirect_uri", form: url.Values{"redirect_uri": {redirectURI + "/other"}, "code_verifier": {verifier}}},
	} {
		t.Run(tc.name+" is refused", func(t *testing.T) {
			code, _ := issue(t, true)
			tc.form.Set("code", code)

			resp, body := exchange(t, tc.form, true, web.Secret)

			assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
			assert.Equal(t, "invalid_grant", body["error"])
		})
	}
}
