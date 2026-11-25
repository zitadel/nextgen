package oauth

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

func decodeJSON(body string, into any) error {
	return json.NewDecoder(strings.NewReader(body)).Decode(into)
}

// The endpoints are under the project ID path, where the library strips the
// tenant and the issuer middleware sees it, so the same issuer is derived
// for an endpoint as for the metadata. Every endpoint answers the library's
// error until it is implemented.
func TestOPEndpointsCarryTheTenant(t *testing.T) {
	t.Parallel()
	admitted := &admission{}
	mux := newMux(t, Config{Admission: admitted})

	// The token endpoint parses the form before any method runs, so the
	// library's own error shows the request reached it with the path intact.
	rec := send(t, mux, http.MethodPost, "/oauth/proj_123/token", "api.example.com", https)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "grant_type missing")
	assert.Empty(t, rec.Header().Get("X-Test-Handler"), "the OP handler answers, not the root")
	assert.Equal(t, []admitCall{{ProjectID: "proj_123", Origin: "https://api.example.com"}}, admitted.calls)

	// A simple endpoint reaches the unimplemented server, which answers 404.
	rec = send(t, mux, http.MethodGet, "/oauth/proj_123/jwks", "api.example.com", https)
	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.Contains(t, rec.Body.String(), "not implemented")

	// A path under the prefix that is no endpoint is the library's 404.
	rec = send(t, mux, http.MethodGet, "/oauth/proj_123/nope", "api.example.com", https)
	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.Empty(t, rec.Header().Get("X-Test-Handler"))
}

// A back-channel request derives no issuer: the admission is asked only
// for a tenant that is a project, and the request continues either way.
func TestOPEndpointsContinueWithoutAnIssuer(t *testing.T) {
	t.Parallel()
	admitted := &admission{}
	mux := newMux(t, Config{Admission: admitted})

	rec := send(t, mux, http.MethodPost, "/oauth/evil/token", "api.example.com", https)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "grant_type missing")
	assert.Empty(t, admitted.calls)

	// The server's own origin, refused by the admission, still reaches the
	// endpoint: the method decides what no issuer means.
	refused := &admission{err: domain.ErrOriginNotFound()}
	mux = newMux(t, Config{Admission: refused})
	rec = send(t, mux, http.MethodPost, "/oauth/proj_123/token", "api.example.com", https)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "grant_type missing")
	require.Len(t, refused.calls, 1)
}

// Every path the handlers do not take stays with whatever else the mux
// serves.
func TestMountLeavesOtherPathsToTheMux(t *testing.T) {
	t.Parallel()
	mux := newMux(t, Config{})

	for _, path := range []string{"/", "/oauth-not", "/api/v1/users/me", "/well-known/x"} {
		rec := send(t, mux, http.MethodGet, path, "api.example.com", nil)
		assert.Equal(t, "root", rec.Header().Get("X-Test-Handler"), path)
	}
}
