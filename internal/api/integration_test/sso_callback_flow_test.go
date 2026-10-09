//go:build postgres_integration || spanner_integration

package integration_test

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	iapi "github.com/zitadel/nextgen/internal/api"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/oidc/v3/pkg/oidc"
)

// These tests drive the real callback route mounted on the harness server,
// against a fake provider on a local listener. Like the resolution tests they
// create projects and users, so they run sequentially for the Spanner emulator.

// ssoTestClientSecret is a canary: it exists to be searched for. It must reach
// the fake provider's token endpoint and nothing else — not the browser, not
// the server log.
const ssoTestClientSecret = "canary-7f3a1b-secret"

// ssoProviderStub answers the two provider endpoints the exchange needs. The
// fields the authorize redirect pins are filled by the test between the submit
// and the callback.
type ssoProviderStub struct {
	srv *httptest.Server
	key *rsa.PrivateKey

	subject     string
	nonce       string
	challenge   string
	redirectURI string
	tokenCalls  int
}

func newSSOProviderStub(t *testing.T) *ssoProviderStub {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	stub := &ssoProviderStub{key: key, subject: "sub-1"}
	stub.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/keys":
			_ = json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{
				{Key: &key.PublicKey, KeyID: "k1", Algorithm: "RS256", Use: "sig"},
			}})
		case "/token":
			stub.tokenCalls++
			user, pass, ok := r.BasicAuth()
			assert.True(t, ok, "the exchange must authenticate")
			assert.Equal(t, "client-1", user)
			assert.Equal(t, ssoTestClientSecret, pass, "the secret must come from the project variable")
			require.NoError(t, r.ParseForm())
			assert.Equal(t, "the-code", r.PostForm.Get("code"))
			assert.Equal(t, stub.redirectURI, r.PostForm.Get("redirect_uri"), "the exchange repeats the pinned redirect_uri")
			assert.Equal(t, stub.challenge, oidc.NewSHACodeChallenge(r.PostForm.Get("code_verifier")),
				"the verifier must be the one the challenge was derived from")

			now := time.Now()
			payload, err := json.Marshal(map[string]any{
				"iss": stub.srv.URL, "aud": "client-1", "sub": stub.subject,
				"exp": now.Add(time.Hour).Unix(), "iat": now.Unix(), "nonce": stub.nonce,
			})
			require.NoError(t, err)
			signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: key}, (&jose.SignerOptions{}).WithHeader("kid", "k1"))
			require.NoError(t, err)
			jws, err := signer.Sign(payload)
			require.NoError(t, err)
			token, err := jws.CompactSerialize()
			require.NoError(t, err)
			_, _ = fmt.Fprintf(w, `{"access_token":"the-access-token","token_type":"bearer","id_token":%q}`, token)
		case "/userinfo":
			assert.Contains(t, r.Header.Get("Authorization"), "the-access-token", "userinfo is read with the exchanged token")
			_, _ = fmt.Fprintf(w, `{"sub":%q,"email":"alice@example.com"}`, stub.subject)
		default:
			t.Errorf("unexpected provider request %s %s", r.Method, r.URL.Path)
		}
	}))
	t.Cleanup(stub.srv.Close)
	return stub
}

// connection is the stub's connection document: static endpoints, both client
// values resolved from project variables.
func (s *ssoProviderStub) connection() api.IdpConnection {
	conn := helpers.OIDCConnection("google")
	oidcConn := conn.Oidc.Value
	oidcConn.Issuer = s.srv.URL
	oidcConn.ClientID = "${{ GOOGLE_CLIENT_ID }}"
	oidcConn.ClientSecret = "${{ GOOGLE_SECRET }}"
	oidcConn.AuthorizationEndpoint = api.NewOptString(s.srv.URL + "/authorize")
	oidcConn.TokenEndpoint = api.NewOptString(s.srv.URL + "/token")
	oidcConn.UserinfoEndpoint = api.NewOptString(s.srv.URL + "/userinfo")
	oidcConn.JwksURI = api.NewOptString(s.srv.URL + "/keys")
	conn.Oidc = api.NewOptIdpConnectionOidc(oidcConn)
	return conn
}

// ssoCallbackFixture is the resolution fixture plus the provider stub and the
// variables both client values resolve from.
type ssoCallbackFixture struct {
	*ssoResolutionFixture
	provider *ssoProviderStub
}

func newSSOCallbackFixture(t *testing.T) *ssoCallbackFixture {
	t.Helper()
	provider := newSSOProviderStub(t)
	f := newSSOResolutionFixture(t, provider.connection())
	require.NoError(t, harness.EnsureVariableService(t).SetVariables(t.Context(),
		domain.VariableOwner{ProjectID: f.project.ID},
		[]service.VariableToSet{
			{Name: "GOOGLE_CLIENT_ID", Value: "client-1"},
			{Name: "GOOGLE_SECRET", Value: ssoTestClientSecret, IsSecret: true},
		}))
	return &ssoCallbackFixture{ssoResolutionFixture: f, provider: provider}
}

// submitSSO submits the sso action and returns the authorize URL the step
// carries and the binding cookie the response set. It pins the stub to the
// values of this submission.
func (f *ssoCallbackFixture) submitSSO(t *testing.T, flow ssoFlow) (authorize *url.URL, binding *http.Cookie) {
	t.Helper()
	returnTarget := "https://login.example.test/login?flow=" + flow.id
	submission := api.FlowSubmitRequest{
		Action:        "sso",
		SSOProviderID: api.NewOptString("google"),
		ReturnTarget:  api.NewOptString(returnTarget),
	}
	body, err := submission.MarshalJSON()
	require.NoError(t, err)
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost,
		harness.EnsureTestServer(t).URL+"/flow/"+flow.id+"/submit", strings.NewReader(string(body)))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://login.example.test")
	req.AddCookie(&http.Cookie{Name: "_zflow", Value: flow.zflow})
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode, string(respBody))
	var ok api.FlowResponse
	require.NoError(t, ok.UnmarshalJSON(respBody), string(respBody))
	require.True(t, ok.Step.RedirectURL.IsSet(), string(respBody))
	redirect := ok.Step.RedirectURL.Value

	for _, cookie := range resp.Cookies() {
		if cookie.Name == "__Host-_zsso" {
			binding = cookie
		}
	}
	require.NotNil(t, binding, "the submit binds the browser")

	query := redirect.Query()
	f.provider.nonce = query.Get("nonce")
	f.provider.challenge = query.Get("code_challenge")
	f.provider.redirectURI = query.Get("redirect_uri")
	require.Equal(t, "https://login.example.test"+iapi.IDPCallbackPath("google"), f.provider.redirectURI)
	return &redirect, binding
}

// returnPath is the path of the redirect_uri the submit sent the provider:
// where an honest provider returns the browser.
func (f *ssoCallbackFixture) returnPath(t *testing.T) string {
	t.Helper()
	redirect, err := url.Parse(f.provider.redirectURI)
	require.NoError(t, err)
	require.NotEmpty(t, redirect.Path, "submitSSO pins the redirect_uri first")
	return redirect.Path
}

// callback performs the provider's redirect against the harness server: a GET
// on path with the given query and cookies, redirects not followed.
func (f *ssoCallbackFixture) callback(t *testing.T, path, query string, cookies ...*http.Cookie) *http.Response {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet,
		harness.EnsureTestServer(t).URL+path+"?"+query, nil)
	require.NoError(t, err)
	for _, cookie := range cookies {
		req.AddCookie(cookie)
	}
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(req)
	require.NoError(t, err)
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

func TestSSOCallbackSignsInTheLinkedUser(t *testing.T) {
	f := newSSOCallbackFixture(t)
	userID := f.createUser(t, defaultSchemaURL())
	f.link(t, f.connection.ID, "sub-1", userID)
	flow := f.startFlow(t, "")
	authorize, binding := f.submitSSO(t, flow)
	state := authorize.Query().Get("state")

	resp := f.callback(t, f.returnPath(t), "state="+url.QueryEscape(state)+"&code=the-code", binding)
	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	require.Equal(t, http.StatusSeeOther, resp.StatusCode, string(body))
	assert.Equal(t, "https://login.example.test/login?flow="+flow.id, resp.Header.Get("Location"))
	assert.Equal(t, 1, f.provider.tokenCalls)

	// The page the browser lands back on renders the flow, which resolves the
	// stored identity through the link and signs the user in.
	requireAuthenticated(t, f.getStep(t, flow))
	attempt := f.attempt(t, flow)
	userFactor, ok := domain.CheckAs[*domain.AuthFactorUser](attempt, domain.AuthCheckTypeUser)
	require.True(t, ok)
	assert.Equal(t, userID, userFactor.UserID)

	// The state is single-use: replaying the same URL answers the uniform
	// error page, and the provider is not asked again.
	replay := f.callback(t, f.returnPath(t), "state="+url.QueryEscape(state)+"&code=the-code", binding)
	assert.Equal(t, http.StatusBadRequest, replay.StatusCode)
	assert.Equal(t, 1, f.provider.tokenCalls)
}

// The proxy-stripped spelling serves the same ceremony: a scaffolded app's SDK
// middleware forwards the callback without the /__nextgen prefix.
func TestSSOCallbackOnTheProxyStrippedPath(t *testing.T) {
	f := newSSOCallbackFixture(t)
	userID := f.createUser(t, defaultSchemaURL())
	f.link(t, f.connection.ID, "sub-1", userID)
	flow := f.startFlow(t, "")
	authorize, binding := f.submitSSO(t, flow)

	resp := f.callback(t, strings.TrimPrefix(f.returnPath(t), "/__nextgen"), "state="+url.QueryEscape(authorize.Query().Get("state"))+"&code=the-code", binding)
	require.Equal(t, http.StatusSeeOther, resp.StatusCode)
	assert.Equal(t, "https://login.example.test/login?flow="+flow.id, resp.Header.Get("Location"))
}

// The mix-up attack (RFC 9700 §4.4): a malicious provider sends the browser on
// to an honest one, which returns to its own connection's callback with the
// state the malicious connection pinned. The path and the state disagree, so
// the code goes to no token endpoint, and the step the sign-in started from
// shows the generic failure.
func TestSSOCallbackOnAnotherConnectionsPathIsRefused(t *testing.T) {
	f := newSSOCallbackFixture(t)
	userID := f.createUser(t, defaultSchemaURL())
	f.link(t, f.connection.ID, "sub-1", userID)
	flow := f.startFlow(t, "")
	authorize, binding := f.submitSSO(t, flow)

	resp := f.callback(t, iapi.IDPCallbackPath("other"), "state="+url.QueryEscape(authorize.Query().Get("state"))+"&code=the-code", binding)
	require.Equal(t, http.StatusSeeOther, resp.StatusCode)
	assert.Equal(t, "https://login.example.test/login?flow="+flow.id, resp.Header.Get("Location"))
	assert.Equal(t, 0, f.provider.tokenCalls, "the code must not reach the pinned connection's token endpoint")

	stepResp := f.getStep(t, flow)
	require.IsType(t, &api.FlowResponseHeaders{}, stepResp, helpers.MustMarshal(t, stepResp))
	step := stepResp.(*api.FlowResponseHeaders).Response.Step
	require.True(t, step.Error.IsSet(), helpers.MustMarshal(t, stepResp))
	assert.Equal(t, domain.FlowStepErrorSSOFailed, step.Error.Value)
	assert.Equal(t, "identifier", step.Name, "the flow stays on the step the sign-in started from")
}

// RFC 9207: a provider registered with a wildcard redirect URI can answer on
// the pinned connection's own path, so the path check passes. Its iss names
// another issuer and is refused before the exchange. The connection's own
// issuer as iss signs in as usual.
func TestSSOCallbackChecksTheIssuerParameter(t *testing.T) {
	f := newSSOCallbackFixture(t)
	userID := f.createUser(t, defaultSchemaURL())
	f.link(t, f.connection.ID, "sub-1", userID)
	flow := f.startFlow(t, "")

	authorize, binding := f.submitSSO(t, flow)
	resp := f.callback(t, f.returnPath(t), "state="+url.QueryEscape(authorize.Query().Get("state"))+"&code=the-code&iss="+url.QueryEscape("https://evil.example.test"), binding)
	require.Equal(t, http.StatusSeeOther, resp.StatusCode)
	assert.Equal(t, 0, f.provider.tokenCalls, "a foreign iss must not reach the token endpoint")
	stepResp := f.getStep(t, flow)
	require.IsType(t, &api.FlowResponseHeaders{}, stepResp, helpers.MustMarshal(t, stepResp))
	step := stepResp.(*api.FlowResponseHeaders).Response.Step
	require.True(t, step.Error.IsSet(), helpers.MustMarshal(t, stepResp))
	assert.Equal(t, domain.FlowStepErrorSSOFailed, step.Error.Value)

	retry, retryCookie := f.submitSSO(t, flow)
	resp = f.callback(t, f.returnPath(t), "state="+url.QueryEscape(retry.Query().Get("state"))+"&code=the-code&iss="+url.QueryEscape(f.provider.srv.URL), retryCookie)
	require.Equal(t, http.StatusSeeOther, resp.StatusCode)
	requireAuthenticated(t, f.getStep(t, flow))
}

// The shared callback that preceded the per-connection routes is not served:
// a request on it reaches no ceremony, so the state stays usable on the
// connection's own route.
func TestSSOCallbackOnTheSharedPathIsNotProcessed(t *testing.T) {
	f := newSSOCallbackFixture(t)
	userID := f.createUser(t, defaultSchemaURL())
	f.link(t, f.connection.ID, "sub-1", userID)
	flow := f.startFlow(t, "")
	authorize, binding := f.submitSSO(t, flow)
	state := "state=" + url.QueryEscape(authorize.Query().Get("state"))

	// Not the code the provider stub accepts, and not the-code: the API
	// catch-all does not redact the query, and the leak test scans the shared
	// server log for the-code.
	for _, path := range []string{"/__nextgen/idp/callback", "/idp/callback"} {
		resp := f.callback(t, path, state+"&code=code-on-the-shared-path", binding)
		assert.NotEqual(t, http.StatusSeeOther, resp.StatusCode, path)
	}
	assert.Equal(t, 0, f.provider.tokenCalls)

	resp := f.callback(t, f.returnPath(t), state+"&code=the-code", binding)
	require.Equal(t, http.StatusSeeOther, resp.StatusCode)
	requireAuthenticated(t, f.getStep(t, flow))
}

// A declined consent comes back as error=access_denied with no code. The
// browser still returns to the page the sign-in started on, where the step
// renders the cancelled key; the provider is never asked for a token. A new
// submission from that step replaces the parked row and signs the user in.
func TestSSOCallbackProviderDeclineRendersCancelledAndAllowsARetry(t *testing.T) {
	f := newSSOCallbackFixture(t)
	userID := f.createUser(t, defaultSchemaURL())
	f.link(t, f.connection.ID, "sub-1", userID)
	flow := f.startFlow(t, "")
	authorize, binding := f.submitSSO(t, flow)

	resp := f.callback(t, f.returnPath(t),
		"state="+url.QueryEscape(authorize.Query().Get("state"))+"&error=access_denied&error_description=user+declined", binding)
	require.Equal(t, http.StatusSeeOther, resp.StatusCode)
	assert.Equal(t, "https://login.example.test/login?flow="+flow.id, resp.Header.Get("Location"))
	assert.Equal(t, 0, f.provider.tokenCalls)

	stepResp := f.getStep(t, flow)
	require.IsType(t, &api.FlowResponseHeaders{}, stepResp, helpers.MustMarshal(t, stepResp))
	step := stepResp.(*api.FlowResponseHeaders).Response.Step
	require.True(t, step.Error.IsSet(), helpers.MustMarshal(t, stepResp))
	assert.Equal(t, domain.FlowStepErrorSSOCancelled, step.Error.Value)
	assert.Equal(t, "identifier", step.Name, "the flow stays on the step the sign-in started from")

	retry, retryCookie := f.submitSSO(t, flow)
	resp = f.callback(t, f.returnPath(t),
		"state="+url.QueryEscape(retry.Query().Get("state"))+"&code=the-code", retryCookie)
	require.Equal(t, http.StatusSeeOther, resp.StatusCode)
	requireAuthenticated(t, f.getStep(t, flow))
}

// A callback without the binding cookie must not consume the state: the record
// survives, so the browser that owns the cookie can still finish.
func TestSSOCallbackWithoutTheBindingCookieLeavesTheStateUsable(t *testing.T) {
	f := newSSOCallbackFixture(t)
	userID := f.createUser(t, defaultSchemaURL())
	f.link(t, f.connection.ID, "sub-1", userID)
	flow := f.startFlow(t, "")
	authorize, binding := f.submitSSO(t, flow)
	state := authorize.Query().Get("state")

	bare := f.callback(t, f.returnPath(t), "state="+url.QueryEscape(state)+"&code=the-code")
	assert.Equal(t, http.StatusBadRequest, bare.StatusCode)
	assert.Equal(t, 0, f.provider.tokenCalls)

	withCookie := f.callback(t, f.returnPath(t), "state="+url.QueryEscape(state)+"&code=the-code", binding)
	assert.Equal(t, http.StatusSeeOther, withCookie.StatusCode)
}

// A second submission replaces the record, so the first submission's callback
// fails like a reused state while the second one finishes the sign-in.
func TestSSOCallbackForAReplacedStateFailsLikeAReusedOne(t *testing.T) {
	f := newSSOCallbackFixture(t)
	userID := f.createUser(t, defaultSchemaURL())
	f.link(t, f.connection.ID, "sub-1", userID)
	flow := f.startFlow(t, "")
	first, firstCookie := f.submitSSO(t, flow)
	second, secondCookie := f.submitSSO(t, flow)

	stale := f.callback(t, f.returnPath(t),
		"state="+url.QueryEscape(first.Query().Get("state"))+"&code=the-code", firstCookie)
	assert.Equal(t, http.StatusBadRequest, stale.StatusCode)
	assert.Equal(t, 0, f.provider.tokenCalls)

	resp := f.callback(t, f.returnPath(t),
		"state="+url.QueryEscape(second.Query().Get("state"))+"&code=the-code", secondCookie)
	assert.Equal(t, http.StatusSeeOther, resp.StatusCode)
	requireAuthenticated(t, f.getStep(t, flow))
}

// Every failure shape answers the same page: a state of another shape, an
// unknown state and a replayed one must be indistinguishable, so none of them
// confirms what exists.
func TestSSOCallbackAnswersInvalidStatesUniformly(t *testing.T) {
	f := newSSOCallbackFixture(t)
	flow := f.startFlow(t, "")
	authorize, binding := f.submitSSO(t, flow)
	state := authorize.Query().Get("state")
	consumed := f.callback(t, f.returnPath(t),
		"state="+url.QueryEscape(state)+"&error=access_denied", binding)
	require.Equal(t, http.StatusSeeOther, consumed.StatusCode)

	var pages []string
	for name, query := range map[string]string{
		"no project prefix": "state=no-separator&code=the-code",
		"unknown state":     "state=" + url.QueryEscape(f.project.ID+".unknown") + "&code=the-code",
		"consumed state":    "state=" + url.QueryEscape(state) + "&code=the-code",
		"foreign project":   "state=" + url.QueryEscape("proj_other."+strings.SplitN(state, ".", 2)[1]) + "&code=the-code",
	} {
		resp := f.callback(t, f.returnPath(t), query, binding)
		body, err := io.ReadAll(resp.Body)
		require.NoError(t, err)
		assert.Equal(t, http.StatusBadRequest, resp.StatusCode, name)
		pages = append(pages, string(body))
	}
	for _, page := range pages[1:] {
		assert.Equal(t, pages[0], page, "every invalid state answers the same bytes")
	}
}

// The canary assertions: the secret leaves the server only toward the token
// endpoint, and neither it nor the single-use request values reach the log.
func TestSSOCallbackLeaksNoSecretIntoResponsesOrLog(t *testing.T) {
	f := newSSOCallbackFixture(t)
	userID := f.createUser(t, defaultSchemaURL())
	f.link(t, f.connection.ID, "sub-1", userID)
	flow := f.startFlow(t, "")
	authorize, binding := f.submitSSO(t, flow)
	state := authorize.Query().Get("state")

	resp := f.callback(t, f.returnPath(t), "state="+url.QueryEscape(state)+"&code=the-code", binding)
	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	require.Equal(t, http.StatusSeeOther, resp.StatusCode)
	require.Equal(t, 1, f.provider.tokenCalls, "the canary reached the token endpoint")

	headers := fmt.Sprint(resp.Header)
	for name, surface := range map[string]string{"response body": string(body), "response headers": headers} {
		assert.NotContains(t, surface, ssoTestClientSecret, name)
	}

	check, parked := f.attempt(t, flow).SSOCallback()
	require.True(t, parked)
	stored, err := json.Marshal(check)
	require.NoError(t, err)
	assert.NotContains(t, string(stored), ssoTestClientSecret, "the parked payload must not carry the secret")
	assert.NotContains(t, string(stored), "the-access-token", "provider tokens are not stored")

	logged := harness.ServerLog()
	// The positive control: the callback request was logged, with its code and
	// state redacted. Without it an empty buffer would pass the scans below.
	assert.Contains(t, logged, "code=redacted")
	assert.Contains(t, logged, "state=redacted")
	assert.NotContains(t, logged, ssoTestClientSecret, "the client secret must never be logged")
	assert.NotContains(t, logged, state, "the single-use state must never be logged")
	assert.NotContains(t, logged, "the-code", "the authorization code must never be logged")
}
