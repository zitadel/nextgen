//go:build postgres_integration

package e2e_test

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
	"github.com/zitadel/oidc/v3/pkg/oidc"

	iapi "github.com/zitadel/nextgen/internal/api"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/migratev4"
	api "go.zitadel.com/zitadel/v5/api"
)

// provider stands in for a v4 IdP's real provider at the issuer the fixture
// configured. The migrated connection is used unchanged: the harness's
// outbound client routes the issuer's host here.
type provider struct {
	t      *testing.T
	issuer *url.URL
	srv    *httptest.Server
	key    *rsa.PrivateKey
	idp    fixtureIDP

	// Pinned from the authorize request the sign-in sent.
	subject     string
	email       string
	nonce       string
	challenge   string
	redirectURI string
	tokenCalls  int
}

func newProvider(t *testing.T, idp fixtureIDP) *provider {
	t.Helper()
	issuer, err := url.Parse(idp.Issuer)
	require.NoError(t, err)
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	p := &provider{t: t, issuer: issuer, key: key, idp: idp}
	p.srv = httptest.NewServer(http.HandlerFunc(p.serve))
	t.Cleanup(p.srv.Close)
	return p
}

// RoundTrip sends requests for the issuer's host to the fake, and every
// other request on.
func (p *provider) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.URL.Host != p.issuer.Host {
		return http.DefaultTransport.RoundTrip(r)
	}
	target, err := url.Parse(p.srv.URL)
	if err != nil {
		return nil, err
	}
	routed := r.Clone(r.Context())
	routed.URL.Scheme, routed.URL.Host = target.Scheme, target.Host
	return http.DefaultTransport.RoundTrip(routed)
}

func (p *provider) serve(w http.ResponseWriter, r *http.Request) {
	issuer := p.idp.Issuer
	w.Header().Set("Content-Type", "application/json")
	switch r.URL.Path {
	case "/.well-known/openid-configuration":
		_ = json.NewEncoder(w).Encode(map[string]any{
			"issuer":                                issuer,
			"authorization_endpoint":                issuer + "/authorize",
			"token_endpoint":                        issuer + "/token",
			"userinfo_endpoint":                     issuer + "/userinfo",
			"jwks_uri":                              issuer + "/keys",
			"response_types_supported":              []string{"code"},
			"subject_types_supported":               []string{"public"},
			"id_token_signing_alg_values_supported": []string{"RS256"},
		})
	case "/keys":
		_ = json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{
			{Key: &p.key.PublicKey, KeyID: "k1", Algorithm: "RS256", Use: "sig"},
		}})
	case "/token":
		p.tokenCalls++
		user, pass, ok := r.BasicAuth()
		assert.True(p.t, ok, "the exchange authenticates the client")
		assert.Equal(p.t, p.idp.ClientID, user, "the client id migrated")
		assert.Equal(p.t, p.idp.ClientSecret, pass, "the client secret migrated, decrypted from v4 and re-encrypted")
		assert.NoError(p.t, r.ParseForm())
		assert.Equal(p.t, "the-code", r.PostForm.Get("code"))
		assert.Equal(p.t, p.redirectURI, r.PostForm.Get("redirect_uri"), "the exchange repeats the redirect_uri")
		assert.Equal(p.t, p.challenge, oidc.NewSHACodeChallenge(r.PostForm.Get("code_verifier")))
		now := time.Now()
		payload, err := json.Marshal(map[string]any{
			"iss": issuer, "aud": p.idp.ClientID, "sub": p.subject,
			"exp": now.Add(time.Hour).Unix(), "iat": now.Unix(), "nonce": p.nonce,
		})
		assert.NoError(p.t, err)
		signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: p.key}, (&jose.SignerOptions{}).WithHeader("kid", "k1"))
		assert.NoError(p.t, err)
		jws, err := signer.Sign(payload)
		assert.NoError(p.t, err)
		token, err := jws.CompactSerialize()
		assert.NoError(p.t, err)
		_, _ = fmt.Fprintf(w, `{"access_token":"the-access-token","token_type":"bearer","id_token":%q}`, token)
	case "/userinfo":
		_ = json.NewEncoder(w).Encode(map[string]any{"sub": p.subject, "email": p.email, "email_verified": true})
	default:
		p.t.Errorf("unexpected provider request %s %s", r.Method, r.URL.Path)
		http.NotFound(w, r)
	}
}

// A user linked to a v4 IdP signs in to nextgen through the migrated
// connection and lands on their migrated account. The connection keeps the
// callback URL v4 registered at the provider: the provider returns the
// browser to the old v4 host, which relays it to the app's own callback
// route, where the code is exchanged with the migrated client credentials.
func TestRecordedV4_LinkedUserSignsInThroughKeptV4Callback(t *testing.T) {
	const kept = "https://auth.acme.test/ui/login/login/externalidp/callback"
	m := newMigration(t, profileSupported)
	opts := m.options(migratev4.IdentifierEmail)
	opts.V4Callback = kept
	_, err := m.migrator.Run(t.Context(), opts)
	require.NoError(t, err)

	corporate := m.idp("Corporate SSO")
	var link fixtureLink
	for _, l := range m.summary.Links {
		if l.IDPID == corporate.ID {
			link = l
			break
		}
	}
	require.NotEmpty(t, link.ExternalUserID, "the fixture links a user to %s", corporate.Name)
	var linked fixtureUser
	for _, u := range m.summary.Users {
		if u.ID == link.UserID {
			linked = u
		}
	}

	p := newProvider(t, corporate)
	p.subject, p.email = link.ExternalUserID, linked.Email
	m.api.EnsureHttpClient(t).Transport = p

	client := m.client()
	f, entry := m.startFlow(client)
	require.True(t, offers(entry, "corporate-sso"), "the migrated login flow offers the instance IdP")

	authorize, binding := m.submitSSO(f, "corporate-sso")
	query := authorize.Query()
	assert.Equal(t, kept, query.Get("redirect_uri"), "the authorize request sends the kept v4 URL")
	assert.Equal(t, corporate.ClientID, query.Get("client_id"))
	p.nonce, p.challenge, p.redirectURI = query.Get("nonce"), query.Get("code_challenge"), query.Get("redirect_uri")

	// The provider sends the browser back to the URL it has registered, on
	// the old v4 host; the browser has no nextgen cookie there.
	callback := "state=" + url.QueryEscape(query.Get("state")) + "&code=the-code"
	relay := m.get(t, "/ui/login/login/externalidp/callback?"+callback, "auth.acme.test")
	require.Equal(t, http.StatusSeeOther, relay.StatusCode, readBody(t, relay))
	require.Equal(t, loginOrigin+iapi.IDPCallbackPath("corporate-sso")+"?"+callback, relay.Header.Get("Location"))

	// The browser follows to the app's own callback route with its cookie.
	back := m.get(t, iapi.IDPCallbackPath("corporate-sso")+"?"+callback, "", binding)
	require.Equal(t, http.StatusSeeOther, back.StatusCode, readBody(t, back))
	assert.Equal(t, 1, p.tokenCalls)

	resp, err := client.GetFlowStep(t.Context(), api.GetFlowStepParams{ID: f.id, Zflow: f.zflow})
	require.NoError(t, err)
	require.IsType(t, &api.FlowResponseHeaders{}, resp, helpers.MustMarshal(t, resp))
	done := resp.(*api.FlowResponseHeaders).Response
	require.True(t, done.Step.Complete.Set, "the sign-in completes; stopped on %q", done.Step.Name)
	assert.Equal(t, m.targetID("user", linked.ID), m.authenticatedUser(f), "the link resolves to the migrated account")
}

// submitSSO submits the sso action the way <zitadel-login> does from
// loginOrigin, and returns the provider's authorize URL and the binding
// cookie the response set.
func (m *migration) submitSSO(f *flow, slug string) (*url.URL, *http.Cookie) {
	m.t.Helper()
	body, err := json.Marshal(map[string]any{
		"action":          "sso",
		"sso_provider_id": slug,
		"return_target":   loginOrigin + "/login?flow=" + f.id,
	})
	require.NoError(m.t, err)
	req, err := http.NewRequestWithContext(m.t.Context(), http.MethodPost,
		m.api.APIBaseURL(m.t)+"/flow/"+f.id+"/submit", strings.NewReader(string(body)))
	require.NoError(m.t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", loginOrigin)
	req.AddCookie(&http.Cookie{Name: "_zflow", Value: f.zflow})
	resp, err := http.DefaultClient.Do(req)
	require.NoError(m.t, err)
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	require.NoError(m.t, err)
	require.Equal(m.t, http.StatusOK, resp.StatusCode, string(raw))
	var step api.FlowResponse
	require.NoError(m.t, step.UnmarshalJSON(raw), string(raw))
	require.True(m.t, step.Step.RedirectURL.IsSet(), string(raw))
	var binding *http.Cookie
	for _, c := range resp.Cookies() {
		switch c.Name {
		case "__Host-_zsso":
			binding = c
		case "_zflow":
			f.zflow = c.Value
		}
	}
	require.NotNil(m.t, binding, "the submit binds the browser")
	redirect := step.Step.RedirectURL.Value
	return &redirect, binding
}

// get is the browser's GET on the server under test, redirects not followed.
// host, when set, is the browser-facing host a TLS-terminating proxy
// forwards.
func (m *migration) get(t *testing.T, pathAndQuery, host string, cookies ...*http.Cookie) *http.Response {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, m.api.EnsureTestServer(t).URL+pathAndQuery, nil)
	require.NoError(t, err)
	if host != "" {
		req.Header.Set("X-Forwarded-Proto", "https")
		req.Header.Set("X-Forwarded-Host", host)
	}
	for _, c := range cookies {
		req.AddCookie(c)
	}
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(req)
	require.NoError(t, err)
	t.Cleanup(func() { _ = resp.Body.Close() })
	return resp
}

func readBody(t *testing.T, resp *http.Response) string {
	t.Helper()
	raw, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	return string(raw)
}
