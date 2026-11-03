package oauth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// serve answers r through the routes the server's mux mounts.
func serve(s *Server, r *http.Request) *httptest.ResponseRecorder {
	mux := http.NewServeMux()
	for _, route := range s.Routes() {
		mux.Handle(route.Pattern, route.Handler)
	}
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, r)
	return w
}

// post sends a back-channel form to path under the platform project's
// namespace.
func post(s *Server, path string, form url.Values, prepare ...func(*http.Request)) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodPost, s.namespace()+path, strings.NewReader(form.Encode()))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	for _, p := range prepare {
		p(r)
	}
	return serve(s, r)
}

// The issuer is the domain the console shares with the server, so its
// metadata sits at that domain's root and names the endpoints under the
// platform project's namespace (ADR 081 §5, §6).
func TestMetadataNamesTheConsolesDomain(t *testing.T) {
	s := newPlainServer(t)
	for _, path := range []string{
		"/.well-known/oauth-authorization-server",
		"/oauth/proj_platform/.well-known/oauth-authorization-server",
	} {
		t.Run(path, func(t *testing.T) {
			w := serve(s, httptest.NewRequest(http.MethodGet, path, nil))

			require.Equal(t, http.StatusOK, w.Code)
			var meta map[string]any
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &meta))
			assert.Equal(t, "https://zitadel.example.com", meta["issuer"])
			assert.Equal(t, "https://zitadel.example.com/oauth/proj_platform/authorize", meta["authorization_endpoint"])
			assert.Equal(t, "https://zitadel.example.com/oauth/proj_platform/token", meta["token_endpoint"])
			assert.Equal(t, "https://zitadel.example.com/oauth/proj_platform/jwks", meta["jwks_uri"])
		})
	}
}

// Each API's RFC 9728 metadata sits at the API's path with the well-known
// segment inserted (§3.1), and the management API is the base the API answers
// under (ADR 077).
func TestResourceMetadataNamesEachAPIByItsBase(t *testing.T) {
	s := newPlainServer(t)
	for path, resource := range map[string]string{
		"/.well-known/oauth-protected-resource/api/v1": "https://zitadel.example.com/api/v1",
		"/.well-known/oauth-protected-resource/mcp":    "https://zitadel.example.com/mcp",
	} {
		t.Run(path, func(t *testing.T) {
			w := serve(s, httptest.NewRequest(http.MethodGet, path, nil))

			require.Equal(t, http.StatusOK, w.Code)
			var meta map[string]any
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &meta))
			assert.Equal(t, resource, meta["resource"])
			assert.Equal(t, []any{"https://zitadel.example.com"}, meta["authorization_servers"])
		})
	}
}

// Every client here is public, and the token endpoint refuses a request it
// cannot read as one public client's before it looks at the code.
func TestTokenEndpointRefusesWhatNoPublicClientSends(t *testing.T) {
	exchange := func(edit func(url.Values)) url.Values {
		form := url.Values{
			"grant_type":    {"authorization_code"},
			"client_id":     {CLIClientID},
			"code":          {"code"},
			"redirect_uri":  {"http://127.0.0.1/callback"},
			"code_verifier": {"verifier"},
		}
		edit(form)
		return form
	}
	unchanged := func(url.Values) {}
	for name, tc := range map[string]struct {
		form    url.Values
		prepare func(*http.Request)
		status  int
		code    string
	}{
		"client credentials": {
			form:    exchange(unchanged),
			prepare: func(r *http.Request) { r.SetBasicAuth(CLIClientID, "secret") },
			status:  http.StatusUnauthorized, code: "invalid_client",
		},
		"an unknown client": {
			form:   exchange(func(f url.Values) { f.Set("client_id", "unknown") }),
			status: http.StatusUnauthorized, code: "invalid_client",
		},
		"a repeated parameter": {
			form:   exchange(func(f url.Values) { f.Add("code", "again") }),
			status: http.StatusBadRequest, code: "invalid_request",
		},
		"two resources": {
			form:   exchange(func(f url.Values) { f["resource"] = []string{"https://a.example", "https://b.example"} }),
			status: http.StatusBadRequest, code: "invalid_target",
		},
	} {
		t.Run(name, func(t *testing.T) {
			var prepare []func(*http.Request)
			if tc.prepare != nil {
				prepare = append(prepare, tc.prepare)
			}
			w := post(newPlainServer(t), "/token", tc.form, prepare...)

			assert.Equal(t, tc.status, w.Code, w.Body.String())
			var body map[string]any
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
			assert.Equal(t, tc.code, body["error"])
		})
	}
}

// A client_id is bounded: a consent's unique key holds it. A longer one names
// no client, so the token endpoint refuses it before anything is stored.
func TestTokenEndpointRefusesAnOverlongClientID(t *testing.T) {
	form := url.Values{
		"grant_type":    {"refresh_token"},
		"client_id":     {"https://agent.example/" + strings.Repeat("a", maxClientIDLength)},
		"refresh_token": {"token"},
	}
	w := post(newPlainServer(t), "/token", form)

	assert.Equal(t, http.StatusUnauthorized, w.Code, w.Body.String())
	var body map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	assert.Equal(t, "invalid_client", body["error"])
}
