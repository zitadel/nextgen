package oauth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/httputil"
)

// admission is a fake Admission that records what it was asked and answers
// with err.
type admission struct {
	err   error
	calls []admitCall
}

type admitCall struct{ ProjectID, Origin string }

func (a *admission) Admit(_ context.Context, projectID, origin string) error {
	a.calls = append(a.calls, admitCall{ProjectID: projectID, Origin: origin})
	return a.err
}

// settings is a fake SettingsSource with one answer for every issuer.
type settings struct {
	settings Settings
	err      error
}

func (s settings) Get(context.Context, Issuer) (Settings, error) {
	return s.settings, s.err
}

var enabled = settings{settings: Settings{Enabled: true}}

// newMux mounts the handlers of cfg as the server does, on a mux whose
// root answers every other path, with a public base of
// https://api.example.com.
func newMux(t *testing.T, cfg Config) http.Handler {
	t.Helper()
	if cfg.PublicBase == nil {
		cfg.PublicBase = mustParseURL(t, "https://api.example.com")
	}
	if cfg.Admission == nil {
		cfg.Admission = &admission{}
	}
	if cfg.Settings == nil {
		cfg.Settings = enabled
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("X-Test-Handler", "root")
		w.WriteHeader(http.StatusTeapot)
	})
	New(cfg).Mount(mux, func(h http.Handler) http.Handler { return h })
	return mux
}

// https is the header set of a request that arrived at a TLS terminator in
// front of the server.
var https = map[string]string{"X-Forwarded-Proto": "https"}

// proxied is the header set of a request that came through the SDK proxy
// of an app at app.example.com.
var proxied = map[string]string{
	"X-Forwarded-Proto":  "https",
	"X-Forwarded-Host":   "app.example.com",
	"X-Forwarded-Prefix": httputil.ProxyPrefix,
}

func send(t *testing.T, h http.Handler, method, path, host string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, path, nil)
	r.Host = host
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	return rec
}

// assertNoStore checks that a metadata response is never served from a
// shared cache and varies with the headers the issuer is read from.
func assertNoStore(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	assert.Equal(t, "no-store", rec.Header().Get("Cache-Control"))
	assert.Contains(t, rec.Header().Values("Vary"), "X-Forwarded-Host, X-Forwarded-Proto, X-Forwarded-Prefix")
}

func assertNoMetadata(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.Empty(t, rec.Header().Get("X-Test-Handler"), "the metadata handler answers, not the root")
	assert.Contains(t, rec.Body.String(), `"error":"invalid_request"`)
	assertNoStore(t, rec)
}

const metadataPath = "/.well-known/oauth-authorization-server"

// The RFC 8414 document of a customer project: the issuer is the URL the
// client fetched, the browser-facing endpoints are under it, and the
// back-channel ones are on the server's public host.
func TestMetadataServesTheAuthorizationServerDocument(t *testing.T) {
	t.Parallel()
	admitted := &admission{}
	mux := newMux(t, Config{Admission: admitted})

	rec := send(t, mux, http.MethodGet, metadataPath+"/oauth/proj_123", "app.example.com", https)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Header().Get("Content-Type"), "application/json")
	assert.JSONEq(t, `{
		"issuer": "https://app.example.com/oauth/proj_123",
		"authorization_endpoint": "https://app.example.com/oauth/proj_123/authorize",
		"token_endpoint": "https://api.example.com/oauth/proj_123/token",
		"jwks_uri": "https://api.example.com/oauth/proj_123/jwks",
		"response_types_supported": ["code"],
		"response_modes_supported": ["query"],
		"grant_types_supported": ["authorization_code"],
		"token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post"],
		"code_challenge_methods_supported": ["S256"]
	}`, rec.Body.String())
	assertNoStore(t, rec)
	assert.Equal(t, []admitCall{{ProjectID: "proj_123", Origin: "https://app.example.com"}}, admitted.calls)
}

// Through the SDK proxy the client fetched the document under the proxy's
// prefix, so the issuer and the authorization endpoint carry it; the token
// endpoint does not, because the client calls the server directly.
func TestMetadataIssuerThroughTheSDKProxy(t *testing.T) {
	t.Parallel()
	mux := newMux(t, Config{})

	rec := send(t, mux, http.MethodGet, metadataPath+"/oauth/proj_123", "api.internal:8080", proxied)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var doc map[string]any
	require.NoError(t, decodeJSON(rec.Body.String(), &doc))
	assert.Equal(t, "https://app.example.com/__nextgen/oauth/proj_123", doc["issuer"])
	assert.Equal(t, "https://app.example.com/__nextgen/oauth/proj_123/authorize", doc["authorization_endpoint"])
	assert.Equal(t, "https://api.example.com/oauth/proj_123/token", doc["token_endpoint"])
	assert.Equal(t, "https://api.example.com/oauth/proj_123/jwks", doc["jwks_uri"])
}

// Of the three well-known forms, only the RFC 8414 one answers: OpenID
// Connect Discovery, in both its forms, stays a 404 until there is an OIDC
// layer. A path outside the prefix names no issuer of this server.
func TestMetadataWellKnownForms(t *testing.T) {
	t.Parallel()
	mux := newMux(t, Config{})

	for path, want := range map[string]int{
		metadataPath + "/oauth/proj_123":                   http.StatusOK,
		"/.well-known/openid-configuration/oauth/proj_123": http.StatusNotFound,
		"/oauth/proj_123/.well-known/openid-configuration": http.StatusNotFound,
		metadataPath + "/other/proj_123":                   http.StatusNotFound,
		metadataPath + "/oauth/proj_123/more":              http.StatusNotFound,
		"/.well-known/something-else":                      http.StatusNotFound,
	} {
		rec := send(t, mux, http.MethodGet, path, "app.example.com", https)
		assert.Equal(t, want, rec.Code, path)
		assert.Empty(t, rec.Header().Get("X-Test-Handler"), "%s: the metadata handler answers, not the root", path)
		assertNoStore(t, rec)
	}
}

// Whatever keeps a request from naming an issuer this server serves gives
// the 404 of an unknown issuer (RFC 8414 §3.3); only the server's own
// failure to decide is a 500.
func TestMetadataRefusals(t *testing.T) {
	t.Parallel()

	t.Run("forged prefix", func(t *testing.T) {
		t.Parallel()
		forged := map[string]string{"X-Forwarded-Proto": "https", "X-Forwarded-Prefix": "/evil"}
		assertNoMetadata(t, send(t, newMux(t, Config{}), http.MethodGet, metadataPath+"/oauth/proj_123", "app.example.com", forged))
	})
	t.Run("admission refused", func(t *testing.T) {
		t.Parallel()
		mux := newMux(t, Config{Admission: DenyAll{}})
		assertNoMetadata(t, send(t, mux, http.MethodGet, metadataPath+"/oauth/proj_123", "app.example.com", https))
	})
	t.Run("oauth not enabled", func(t *testing.T) {
		t.Parallel()
		mux := newMux(t, Config{Settings: NotEnabled{}})
		assertNoMetadata(t, send(t, mux, http.MethodGet, metadataPath+"/oauth/proj_123", "app.example.com", https))
	})
	t.Run("tenant is not a project", func(t *testing.T) {
		t.Parallel()
		assertNoMetadata(t, send(t, newMux(t, Config{}), http.MethodGet, metadataPath+"/oauth/evil", "app.example.com", https))
	})
	t.Run("admission could not decide", func(t *testing.T) {
		t.Parallel()
		mux := newMux(t, Config{Admission: &admission{err: domain.ErrInternal(nil)}})
		rec := send(t, mux, http.MethodGet, metadataPath+"/oauth/proj_123", "app.example.com", https)
		assert.Equal(t, http.StatusInternalServerError, rec.Code)
		assertNoStore(t, rec)
	})
	t.Run("settings could not be read", func(t *testing.T) {
		t.Parallel()
		mux := newMux(t, Config{Settings: settings{err: domain.ErrUnavailable()}})
		rec := send(t, mux, http.MethodGet, metadataPath+"/oauth/proj_123", "app.example.com", https)
		assert.Equal(t, http.StatusInternalServerError, rec.Code)
		assertNoStore(t, rec)
	})
}

// The empty tenant is the platform project's issuer at the prefix itself,
// and only on a deployment that has a platform project.
func TestMetadataEmptyTenant(t *testing.T) {
	t.Parallel()

	t.Run("without a platform project", func(t *testing.T) {
		t.Parallel()
		mux := newMux(t, Config{PlatformEnabled: false})
		assertNoMetadata(t, send(t, mux, http.MethodGet, metadataPath+"/oauth", "api.example.com", https))
	})
	t.Run("through the SDK proxy", func(t *testing.T) {
		t.Parallel()
		mux := newMux(t, Config{PlatformEnabled: true})
		assertNoMetadata(t, send(t, mux, http.MethodGet, metadataPath+"/oauth", "api.internal", proxied))
	})
	t.Run("with a platform project", func(t *testing.T) {
		t.Parallel()
		admitted := &admission{}
		mux := newMux(t, Config{PlatformEnabled: true, Admission: admitted})
		rec := send(t, mux, http.MethodGet, metadataPath+"/oauth", "api.example.com", https)
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		var doc map[string]any
		require.NoError(t, decodeJSON(rec.Body.String(), &doc))
		assert.Equal(t, "https://api.example.com/oauth", doc["issuer"])
		assert.Equal(t, "https://api.example.com/oauth/authorize", doc["authorization_endpoint"])
		assert.Equal(t, "https://api.example.com/oauth/token", doc["token_endpoint"])
		assert.Equal(t, []admitCall{{ProjectID: domain.PlatformProjectID, Origin: "https://api.example.com"}}, admitted.calls)

		// Its OpenID Connect Discovery form is routed to the metadata handler
		// too, where it stays a 404 like every other.
		assertNoMetadata(t, send(t, mux, http.MethodGet, "/oauth/.well-known/openid-configuration", "api.example.com", https))
	})
}

// A browser on any origin may read the metadata, without credentials
// (ADR 081 §6).
func TestMetadataCORS(t *testing.T) {
	t.Parallel()
	mux := newMux(t, Config{})
	origin := map[string]string{"X-Forwarded-Proto": "https", "Origin": "https://spa.example.com"}

	rec := send(t, mux, http.MethodGet, metadataPath+"/oauth/proj_123", "app.example.com", origin)
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "*", rec.Header().Get("Access-Control-Allow-Origin"))
	assert.Empty(t, rec.Header().Get("Access-Control-Allow-Credentials"))

	preflight := map[string]string{
		"X-Forwarded-Proto":              "https",
		"Origin":                         "https://spa.example.com",
		"Access-Control-Request-Method":  http.MethodGet,
		"Access-Control-Request-Headers": "authorization",
	}
	rec = send(t, mux, http.MethodOptions, metadataPath+"/oauth/proj_123", "app.example.com", preflight)
	assert.Equal(t, http.StatusNoContent, rec.Code)
	assert.Equal(t, "*", rec.Header().Get("Access-Control-Allow-Origin"))
	assert.Contains(t, strings.ToLower(rec.Header().Get("Access-Control-Allow-Headers")), "authorization")
	assert.Empty(t, rec.Header().Get("Access-Control-Allow-Credentials"))
}
