package oauth

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

const (
	tokenPath    = "/oauth/proj_123/token"
	clientSecret = "s3cret"
	// verifier is the PKCE verifier of RFC 7636 appendix B.
	verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
)

// AuthenticateClient knows one secret for every client of the fake.
func (c clients) AuthenticateClient(ctx context.Context, projectID, clientID, secret string) (*service.ServedApplicationClient, error) {
	doc, err := c.Client(ctx, projectID, "", clientID)
	if err != nil {
		return nil, err
	}
	if secret != clientSecret {
		return nil, domain.ErrApplicationClientSecretInvalid()
	}
	return &service.ServedApplicationClient{Document: doc}, nil
}

func (f failing) AuthenticateClient(context.Context, string, string, string) (*service.ServedApplicationClient, error) {
	return nil, f.err
}

// RedeemCode is never reached in the authorization endpoint's tests.
func (a *authRequests) RedeemCode(context.Context, service.RedeemCodeInput) (string, time.Duration, error) {
	return "", 0, errors.New("authRequests redeems no codes")
}

// recording is a ClientResolver over clients that records the project each
// authentication looks the client up in.
type recording struct {
	clients
	projectIDs []string
}

func (r *recording) AuthenticateClient(ctx context.Context, projectID, clientID, secret string) (*service.ServedApplicationClient, error) {
	r.projectIDs = append(r.projectIDs, projectID)
	return r.clients.AuthenticateClient(ctx, projectID, clientID, secret)
}

// codes is a fake AuthRequestStore that records the redemptions it gets and
// answers each with token, expiresIn or err.
type codes struct {
	got       []service.RedeemCodeInput
	token     string
	expiresIn time.Duration
	err       error
}

func (c *codes) Create(context.Context, *domain.AuthRequest) (string, error) {
	return "", errors.New("codes stores no requests")
}

func (c *codes) RedeemCode(_ context.Context, input service.RedeemCodeInput) (string, time.Duration, error) {
	c.got = append(c.got, input)
	return c.token, c.expiresIn, c.err
}

// tokenForm is a valid code exchange, with set applied; an empty value
// removes the parameter.
func tokenForm(set map[string]string) url.Values {
	form := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {"the-code"},
		"redirect_uri":  {callback},
		"code_verifier": {verifier},
	}
	for k, v := range set {
		if v == "" {
			form.Del(k)
			continue
		}
		form.Set(k, v)
	}
	return form
}

// postToken sends form to path as a back-channel request, with HTTP Basic
// authentication when user is set.
func postToken(t *testing.T, h http.Handler, method, path string, form url.Values, user, password string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, path, strings.NewReader(form.Encode()))
	r.Host = "api.example.com"
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if user != "" {
		r.SetBasicAuth(url.QueryEscape(user), url.QueryEscape(password))
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	return rec
}

// tokenError is the error body of the token endpoint.
type tokenError struct {
	Error       string `json:"error"`
	Description string `json:"error_description"`
}

func decodeTokenError(t *testing.T, rec *httptest.ResponseRecorder) tokenError {
	t.Helper()
	var body tokenError
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body), rec.Body.String())
	return body
}

// A client authenticated with its secret, in the Authorization header or in
// the form, exchanges a code for an access token. Only the access token, its
// type and its lifetime are answered.
func TestTokenExchangesACode(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name           string
		path           string
		platform       bool
		set            map[string]string
		user, password string
		wantProjectID  string
		// expiresIn is what the store answers; the token lives AccessTokenTTL
		// when unset.
		expiresIn     time.Duration
		wantExpiresIn float64
	}{
		{name: "client_secret_basic", user: "shop", password: clientSecret},
		{
			// The session expires first: expires_in is its rest, in whole
			// seconds rounded down.
			name:          "session_expires_first",
			user:          "shop",
			password:      clientSecret,
			expiresIn:     2*time.Minute + 999*time.Millisecond,
			wantExpiresIn: 120,
		},
		{name: "client_secret_post", set: map[string]string{"client_id": "shop", "client_secret": clientSecret}},
		{name: "without_pkce", set: map[string]string{"code_verifier": ""}, user: "shop", password: clientSecret},
		// The empty tenant is the platform project's issuer.
		{name: "platform_issuer", path: "/oauth/token", platform: true, user: "shop", password: clientSecret, wantProjectID: domain.PlatformProjectID},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			store := &codes{token: "the-access-token", expiresIn: cmp.Or(tt.expiresIn, domain.AccessTokenTTL)}
			resolver := &recording{clients: shop}
			mux := newMux(t, Config{PlatformEnabled: tt.platform, Clients: resolver, AuthRequests: store})
			path := tokenPath
			if tt.path != "" {
				path = tt.path
			}
			wantProjectID := "proj_123"
			if tt.wantProjectID != "" {
				wantProjectID = tt.wantProjectID
			}

			rec := postToken(t, mux, http.MethodPost, path, tokenForm(tt.set), tt.user, tt.password)

			require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
			assert.Equal(t, "no-store", rec.Header().Get("Cache-Control"))
			var body map[string]any
			require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
			assert.Equal(t, map[string]any{
				"access_token": "the-access-token",
				"token_type":   "Bearer",
				"expires_in":   cmp.Or(tt.wantExpiresIn, 300),
			}, body, "no scope, refresh_token or id_token")
			wantVerifier := verifier
			if _, ok := tt.set["code_verifier"]; ok {
				wantVerifier = ""
			}
			assert.Equal(t, []string{wantProjectID}, resolver.projectIDs, "the client is looked up in the path's project")
			assert.Equal(t, []service.RedeemCodeInput{{
				ProjectID:    wantProjectID,
				ClientID:     "shop",
				Code:         "the-code",
				RedirectURI:  callback,
				CodeVerifier: wantVerifier,
			}}, store.got)
		})
	}
}

// A client that does not authenticate is refused before its code is read.
// An unknown client and a wrong secret get the same answer, so the endpoint
// does not tell which client IDs exist. A 401 names the Basic scheme
// (RFC 6749 §5.2).
func TestTokenRefusesTheClient(t *testing.T) {
	t.Parallel()
	refused := tokenError{Error: "invalid_client", Description: "client authentication failed"}
	tests := []struct {
		name           string
		path           string
		set            map[string]string
		user, password string
		clients        ClientResolver
		wantStatus     int
		want           tokenError
	}{
		{name: "unknown_client_basic", user: "nobody", password: clientSecret, wantStatus: http.StatusUnauthorized, want: refused},
		{name: "wrong_secret_basic", user: "shop", password: "wrong", wantStatus: http.StatusUnauthorized, want: refused},
		{name: "unknown_client_post", set: map[string]string{"client_id": "nobody", "client_secret": clientSecret}, wantStatus: http.StatusUnauthorized, want: refused},
		{name: "wrong_secret_post", set: map[string]string{"client_id": "shop", "client_secret": "wrong"}, wantStatus: http.StatusUnauthorized, want: refused},
		{
			name:       "no_secret",
			set:        map[string]string{"client_id": "shop"},
			wantStatus: http.StatusUnauthorized,
			want:       tokenError{Error: "invalid_client", Description: "the client must authenticate with its client secret"},
		},
		{
			name:       "client_assertion",
			set:        map[string]string{"client_id": "shop", "client_assertion": "a.b.c", "client_assertion_type": "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"},
			wantStatus: http.StatusUnauthorized,
			want:       tokenError{Error: "invalid_client", Description: "the client must authenticate with its client secret"},
		},
		{
			// The client ID is never looked up: a NUL byte is text no
			// dialect stores, and the resolver would answer a 500.
			name:       "client_id_with_nul",
			set:        map[string]string{"client_id": "sh\x00op", "client_secret": clientSecret},
			clients:    failing{err: errors.New("the resolver must not be called")},
			wantStatus: http.StatusUnauthorized,
			want:       refused,
		},
		{
			// No client holds an ID longer than application.json allows.
			name:       "client_id_too_long",
			set:        map[string]string{"client_id": strings.Repeat("a", 256), "client_secret": clientSecret},
			clients:    failing{err: errors.New("the resolver must not be called")},
			wantStatus: http.StatusUnauthorized,
			want:       refused,
		},
		{
			// A declared client needs a deployment, which a token request does
			// not name yet: it is refused like an unknown client.
			name:       "declared_client",
			user:       "shop",
			password:   clientSecret,
			clients:    failing{err: domain.ErrReleaseNotDeployed(nil)},
			wantStatus: http.StatusUnauthorized,
			want:       refused,
		},
		{name: "project_id_malformed", path: "/oauth/not-a-project/token", user: "shop", password: clientSecret, wantStatus: http.StatusUnauthorized, want: refused},
		{name: "platform_issuer_off", path: "/oauth/token", user: "shop", password: clientSecret, wantStatus: http.StatusUnauthorized, want: refused},
		{
			name:       "lookup_unavailable",
			user:       "shop",
			password:   clientSecret,
			clients:    failing{err: domain.ErrUnavailable()},
			wantStatus: http.StatusServiceUnavailable,
			want:       tokenError{Error: "temporarily_unavailable"},
		},
		{
			name:       "lookup_fails",
			user:       "shop",
			password:   clientSecret,
			clients:    failing{err: domain.ErrInternal(errors.New("boom"))},
			wantStatus: http.StatusInternalServerError,
			want:       tokenError{Error: "server_error"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			store := &codes{token: "the-access-token"}
			resolver := tt.clients
			if resolver == nil {
				resolver = shop
			}
			mux := newMux(t, Config{Clients: resolver, AuthRequests: store})
			path := tokenPath
			if tt.path != "" {
				path = tt.path
			}

			rec := postToken(t, mux, http.MethodPost, path, tokenForm(tt.set), tt.user, tt.password)

			require.Equal(t, tt.wantStatus, rec.Code, rec.Body.String())
			assert.Equal(t, tt.want, decodeTokenError(t, rec))
			assert.Empty(t, store.got, "the code is not read")
			if tt.wantStatus == http.StatusUnauthorized {
				assert.Equal(t, `Basic realm="oauth"`, rec.Header().Get("WWW-Authenticate"))
			} else {
				assert.Empty(t, rec.Header().Get("WWW-Authenticate"))
			}
		})
	}
}

// A request the endpoint cannot read the same way as a filter in front of
// it is refused before the client is authenticated.
func TestTokenRefusesTheRequest(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name   string
		method string
		form   url.Values
		// inQuery sends form in the URL query instead of the body.
		inQuery        bool
		user, password string
		wantStatus     int
		wantError      string
	}{
		{
			name:       "parameter_repeated",
			form:       url.Values{"grant_type": {"authorization_code"}, "code": {"a", "b"}, "redirect_uri": {callback}},
			user:       "shop",
			password:   clientSecret,
			wantStatus: http.StatusBadRequest,
			wantError:  "invalid_request",
		},
		{
			// Two methods of client authentication at once (RFC 6749 §2.3).
			name:       "basic_and_post",
			form:       tokenForm(map[string]string{"client_id": "shop", "client_secret": clientSecret}),
			user:       "shop",
			password:   clientSecret,
			wantStatus: http.StatusBadRequest,
			wantError:  "invalid_request",
		},
		{
			// A GET would carry the secret in the URL (RFC 6749 §3.2).
			name:       "get",
			method:     http.MethodGet,
			form:       tokenForm(nil),
			inQuery:    true,
			user:       "shop",
			password:   clientSecret,
			wantStatus: http.StatusBadRequest,
			wantError:  "invalid_request",
		},
		{
			// The credentials must not be in the URL (RFC 6749 §2.3.1), even
			// on a POST.
			name:       "secret_in_query",
			form:       tokenForm(map[string]string{"client_id": "shop", "client_secret": clientSecret}),
			inQuery:    true,
			wantStatus: http.StatusBadRequest,
			wantError:  "invalid_request",
		},
		{
			name:       "client_without_the_grant",
			form:       tokenForm(nil),
			user:       "no-codes",
			password:   clientSecret,
			wantStatus: http.StatusBadRequest,
			wantError:  "unauthorized_client",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			store := &codes{token: "the-access-token"}
			mux := newMux(t, Config{Clients: shop, AuthRequests: store})
			method := cmp.Or(tt.method, http.MethodPost)
			path := tokenPath
			if tt.inQuery {
				path += "?" + tt.form.Encode()
				tt.form = nil
			}

			rec := postToken(t, mux, method, path, tt.form, tt.user, tt.password)

			require.Equal(t, tt.wantStatus, rec.Code, rec.Body.String())
			assert.Equal(t, tt.wantError, decodeTokenError(t, rec).Error)
			assert.Empty(t, store.got, "the code is not read")
		})
	}
}

// Each refusal of the code is invalid_grant. The client learns the cause only
// for what it sent itself: the redirect_uri and the code_verifier. A server
// fault, whatever its code, is a 500, or a 503 when a retry may succeed.
func TestTokenRefusesTheCode(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name       string
		err        error
		wantStatus int
		want       tokenError
	}{
		{
			name:       "code_invalid",
			err:        domain.ErrAuthCodeInvalid(),
			wantStatus: http.StatusBadRequest,
			want:       tokenError{Error: "invalid_grant", Description: "the code is invalid, expired or already used"},
		},
		{
			name:       "redirect_uri_mismatch",
			err:        domain.ErrAuthCodeRedirectURIMismatch(),
			wantStatus: http.StatusBadRequest,
			want:       tokenError{Error: "invalid_grant", Description: "redirect_uri does not match the authorization request"},
		},
		{
			name:       "code_verifier_missing",
			err:        domain.ErrAuthCodeVerifierMissing(),
			wantStatus: http.StatusBadRequest,
			want:       tokenError{Error: "invalid_grant", Description: "code_verifier is required"},
		},
		{
			name:       "code_verifier_invalid",
			err:        domain.ErrAuthCodeVerifierInvalid(),
			wantStatus: http.StatusBadRequest,
			want:       tokenError{Error: "invalid_grant", Description: "code_verifier does not match the code_challenge"},
		},
		{
			name:       "code_verifier_unexpected",
			err:        domain.ErrAuthCodeVerifierUnexpected(),
			wantStatus: http.StatusBadRequest,
			want:       tokenError{Error: "invalid_grant", Description: "code_verifier was sent, but the authorization request had no code_challenge"},
		},
		{
			name:       "unavailable",
			err:        domain.ErrUnavailable(),
			wantStatus: http.StatusServiceUnavailable,
			want:       tokenError{Error: "temporarily_unavailable"},
		},
		{
			// The signing key's encryption key is missing: a fault, though
			// not an internal error by its code.
			name:       "encryption_key_missing",
			err:        domain.ErrEncryptionKeyNotFound(),
			wantStatus: http.StatusInternalServerError,
			want:       tokenError{Error: "server_error"},
		},
		{
			name:       "internal",
			err:        domain.ErrInternal(errors.New("boom")),
			wantStatus: http.StatusInternalServerError,
			want:       tokenError{Error: "server_error"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			store := &codes{err: tt.err}
			mux := newMux(t, Config{Clients: shop, AuthRequests: store})

			rec := postToken(t, mux, http.MethodPost, tokenPath, tokenForm(nil), "shop", clientSecret)

			require.Equal(t, tt.wantStatus, rec.Code, rec.Body.String())
			assert.Equal(t, tt.want, decodeTokenError(t, rec))
			assert.Len(t, store.got, 1)
		})
	}
}

// Only the token endpoint authenticates clients. The revocation endpoint is
// not served yet: it answers as it did before, whatever secret the client
// sends, and the client is not looked up.
func TestRevocationIsNotServed(t *testing.T) {
	t.Parallel()
	mux := newMux(t, Config{Clients: failing{err: errors.New("the resolver must not be called")}, AuthRequests: &codes{}})
	form := url.Values{"token": {"a-token"}}

	right := postToken(t, mux, http.MethodPost, "/oauth/proj_123/revoke", form, "shop", clientSecret)
	wrong := postToken(t, mux, http.MethodPost, "/oauth/proj_123/revoke", form, "shop", "wrong")

	require.Equal(t, http.StatusNotFound, right.Code, right.Body.String())
	assert.Equal(t, "server_error", decodeTokenError(t, right).Error)
	assert.Equal(t, right.Code, wrong.Code)
	assert.Equal(t, right.Body.String(), wrong.Body.String())
	assert.Empty(t, wrong.Header().Get("WWW-Authenticate"))
}

// The Basic challenge belongs to the token endpoint's 401 only. Userinfo,
// which takes a bearer token (RFC 6750), gets none.
func TestUserinfoRefusalNamesNoBasicChallenge(t *testing.T) {
	t.Parallel()
	mux := newMux(t, Config{Clients: shop, AuthRequests: &codes{}})

	rec := send(t, mux, http.MethodGet, "/oauth/proj_123/userinfo", "api.example.com", nil)

	require.Equal(t, http.StatusUnauthorized, rec.Code, rec.Body.String())
	assert.Empty(t, rec.Header().Get("WWW-Authenticate"))
}
