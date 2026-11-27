package oauth

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

// signingKeys is a fake SigningKeys holding one key set per project.
type signingKeys struct {
	keys  map[string][]jose.JSONWebKey
	err   error
	asked []string
}

func (s *signingKeys) GetProjectPublicSigningKeys(_ context.Context, projectID string, purpose domain.SigningKeyPurpose) ([]jose.JSONWebKey, error) {
	s.asked = append(s.asked, projectID)
	if purpose != domain.SigningKeyPurposeToken {
		return nil, errors.New("unexpected purpose")
	}
	return s.keys[projectID], s.err
}

// newPublicKey returns the public JWK of a fresh Ed25519 key under kid.
func newPublicKey(t *testing.T, kid string) jose.JSONWebKey {
	t.Helper()
	public, _, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	return jose.JSONWebKey{Key: public, KeyID: kid, Algorithm: string(jose.EdDSA), Use: "sig"}
}

func fetchJWKS(t *testing.T, mux http.Handler, path string) jose.JSONWebKeySet {
	t.Helper()
	rec := send(t, mux, http.MethodGet, path, "api.example.com", https)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var set jose.JSONWebKeySet
	require.NoError(t, decodeJSON(rec.Body.String(), &set))
	return set
}

func keyIDs(set jose.JSONWebKeySet) []string {
	ids := make([]string, 0, len(set.Keys))
	for _, key := range set.Keys {
		ids = append(ids, key.KeyID)
	}
	return ids
}

// Each project's set holds that project's keys, a queued one included, and
// no other project's.
func TestKeysServeOnlyTheirProjectsKeys(t *testing.T) {
	t.Parallel()
	keys := &signingKeys{keys: map[string][]jose.JSONWebKey{
		"proj_app":   {newPublicKey(t, "sig_key_app"), newPublicKey(t, "sig_key_queued")},
		"proj_other": {newPublicKey(t, "sig_key_other")},
	}}
	mux := newMux(t, Config{SigningKeys: keys})

	assert.Equal(t, []string{"sig_key_app", "sig_key_queued"}, keyIDs(fetchJWKS(t, mux, "/oauth/proj_app/jwks")),
		"a queued key is published before it signs")
	assert.Equal(t, []string{"sig_key_other"}, keyIDs(fetchJWKS(t, mux, "/oauth/proj_other/jwks")))
	assert.Equal(t, []string{"proj_app", "proj_other"}, keys.asked)
}

// The set depends on the tenant alone, so a shared cache may keep it for
// the configured max age, and a request through the app's proxy gets the
// same set as one on the public base.
func TestKeysAreCacheableAndTheSameAtEveryOrigin(t *testing.T) {
	t.Parallel()
	key := newPublicKey(t, "sig_key_app")
	keys := &signingKeys{keys: map[string][]jose.JSONWebKey{"proj_app": {key}}}
	mux := newMux(t, Config{SigningKeys: keys, JWKSMaxAge: 90 * time.Second, Admission: &admission{err: domain.ErrOriginNotFound()}})

	direct := send(t, mux, http.MethodGet, "/oauth/proj_app/jwks", "api.example.com", https)
	require.Equal(t, http.StatusOK, direct.Code)
	assert.Equal(t, "public, max-age=90", direct.Header().Get("Cache-Control"))
	assert.Equal(t, "application/json", direct.Header().Get("Content-Type"))

	proxiedRec := send(t, mux, http.MethodGet, "/oauth/proj_app/jwks", "internal:8080", proxied)
	require.Equal(t, http.StatusOK, proxiedRec.Code)
	assert.JSONEq(t, direct.Body.String(), proxiedRec.Body.String())
}

func TestKeysOfThePlatformProject(t *testing.T) {
	t.Parallel()
	key := newPublicKey(t, "sig_key_platform")
	keys := &signingKeys{keys: map[string][]jose.JSONWebKey{domain.PlatformProjectID: {key}}}

	set := fetchJWKS(t, newMux(t, Config{SigningKeys: keys, PlatformEnabled: true}), "/oauth/jwks")
	require.Len(t, set.Keys, 1)
	assert.Equal(t, "sig_key_platform", set.Keys[0].KeyID)

	rec := send(t, newMux(t, Config{SigningKeys: keys}), http.MethodGet, "/oauth/jwks", "api.example.com", https)
	assert.Equal(t, http.StatusNotFound, rec.Code, "no platform project, no platform keys")
}

// A project whose newest primary deployment has OAuth off has no set. That
// is also how a project that does not exist reads (ReleaseSettings has it
// off), so the answer is the 404 any tenant that names no project gets, and
// the set does not tell which projects exist. Its keys are not read.
func TestKeysNeedOAuthEnabled(t *testing.T) {
	t.Parallel()
	key := newPublicKey(t, "sig_key_app")
	keys := &signingKeys{keys: map[string][]jose.JSONWebKey{"proj_app": {key}}}

	off := send(t, newMux(t, Config{SigningKeys: keys, Settings: settings{}}), http.MethodGet, "/oauth/proj_app/jwks", "api.example.com", https)
	unknown := send(t, newMux(t, Config{SigningKeys: &signingKeys{}}), http.MethodGet, "/oauth/evil/jwks", "api.example.com", https)

	assert.Equal(t, http.StatusNotFound, off.Code)
	assert.Equal(t, unknown.Code, off.Code)
	assert.JSONEq(t, unknown.Body.String(), off.Body.String())
	assert.Empty(t, keys.asked)
}

func TestKeysRefusals(t *testing.T) {
	t.Parallel()
	key := newPublicKey(t, "sig_key_platform")

	for _, tt := range []struct {
		name     string
		path     string
		keys     *signingKeys
		settings SettingsSource
		status   int
	}{
		{name: "an enabled project without keys", path: "/oauth/proj_app/jwks", keys: &signingKeys{}, status: http.StatusInternalServerError},
		{name: "a tenant that is no project ID", path: "/oauth/evil/jwks", keys: &signingKeys{}, status: http.StatusNotFound},
		{name: "a tenant with a NUL", path: "/oauth/proj_%00/jwks", keys: &signingKeys{}, status: http.StatusNotFound},
		{name: "a tenant that is not UTF-8", path: "/oauth/proj_%ff/jwks", keys: &signingKeys{}, status: http.StatusNotFound},
		{
			name:   "the platform project's ID as a tenant",
			path:   "/oauth/" + domain.PlatformProjectID + "/jwks",
			keys:   &signingKeys{keys: map[string][]jose.JSONWebKey{domain.PlatformProjectID: {key}}},
			status: http.StatusNotFound,
		},
		{name: "a fault reading the keys", path: "/oauth/proj_app/jwks", keys: &signingKeys{err: domain.ErrUnavailable()}, status: http.StatusInternalServerError},
		{
			name:     "a fault reading the settings",
			path:     "/oauth/proj_app/jwks",
			keys:     &signingKeys{},
			settings: settings{err: domain.ErrUnavailable()},
			status:   http.StatusInternalServerError,
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			rec := send(t, newMux(t, Config{SigningKeys: tt.keys, Settings: tt.settings, PlatformEnabled: true}), http.MethodGet, tt.path, "api.example.com", https)
			assert.Equal(t, tt.status, rec.Code)
			assert.Equal(t, "no-store", rec.Header().Get("Cache-Control"), "a refusal is never cached")
			if tt.status == http.StatusNotFound {
				assert.Empty(t, tt.keys.asked, "a refused tenant reads no keys")
			}
		})
	}
}
