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

// newSigningKey returns a signer for a fresh Ed25519 key and its public JWK
// under kid.
func newSigningKey(t *testing.T, kid string) (jose.Signer, jose.JSONWebKey) {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.EdDSA, Key: jose.JSONWebKey{Key: private, KeyID: kid}}, nil)
	require.NoError(t, err)
	return signer, jose.JSONWebKey{Key: public, KeyID: kid, Algorithm: string(jose.EdDSA), Use: "sig"}
}

func fetchJWKS(t *testing.T, mux http.Handler, path string) jose.JSONWebKeySet {
	t.Helper()
	rec := send(t, mux, http.MethodGet, path, "api.example.com", https)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var set jose.JSONWebKeySet
	require.NoError(t, decodeJSON(rec.Body.String(), &set))
	return set
}

// A token a project signs verifies against that project's JWKS and not
// against another project's.
func TestKeysVerifyOnlyTheirProjectsTokens(t *testing.T) {
	t.Parallel()
	signer, appKey := newSigningKey(t, "sig_key_app")
	_, otherKey := newSigningKey(t, "sig_key_other")
	_, queuedKey := newSigningKey(t, "sig_key_queued")
	keys := &signingKeys{keys: map[string][]jose.JSONWebKey{
		"proj_app":   {appKey, queuedKey},
		"proj_other": {otherKey},
	}}
	mux := newMux(t, Config{SigningKeys: keys})

	jws, err := signer.Sign([]byte(`{"sub":"user_1"}`))
	require.NoError(t, err)
	token, err := jws.CompactSerialize()
	require.NoError(t, err)
	verify := func(set jose.JSONWebKeySet) error {
		parsed, err := jose.ParseSigned(token, []jose.SignatureAlgorithm{jose.EdDSA})
		require.NoError(t, err)
		found := set.Key(parsed.Signatures[0].Header.KeyID)
		if len(found) == 0 {
			return errors.New("no key with the token's kid")
		}
		_, err = parsed.Verify(found[0])
		return err
	}

	appSet := fetchJWKS(t, mux, "/oauth/proj_app/jwks")
	assert.Len(t, appSet.Keys, 2, "a queued key is published before it signs")
	assert.NoError(t, verify(appSet))
	for _, key := range appSet.Keys {
		assert.True(t, key.IsPublic())
	}

	assert.Error(t, verify(fetchJWKS(t, mux, "/oauth/proj_other/jwks")))
	assert.Equal(t, []string{"proj_app", "proj_other"}, keys.asked)
}

// The set depends on the tenant alone, so a shared cache may keep it for
// the configured max age, and a request through the app's proxy gets the
// same set as one on the public base.
func TestKeysAreCacheableAndTheSameAtEveryOrigin(t *testing.T) {
	t.Parallel()
	_, key := newSigningKey(t, "sig_key_app")
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
	_, key := newSigningKey(t, "sig_key_platform")
	keys := &signingKeys{keys: map[string][]jose.JSONWebKey{domain.PlatformProjectID: {key}}}

	set := fetchJWKS(t, newMux(t, Config{SigningKeys: keys, PlatformEnabled: true}), "/oauth/jwks")
	require.Len(t, set.Keys, 1)
	assert.Equal(t, "sig_key_platform", set.Keys[0].KeyID)

	rec := send(t, newMux(t, Config{SigningKeys: keys}), http.MethodGet, "/oauth/jwks", "api.example.com", https)
	assert.Equal(t, http.StatusNotFound, rec.Code, "no platform project, no platform keys")
}

func TestKeysRefusals(t *testing.T) {
	t.Parallel()
	_, key := newSigningKey(t, "sig_key_platform")

	for _, tt := range []struct {
		name   string
		path   string
		keys   *signingKeys
		status int
	}{
		{name: "a project without keys", path: "/oauth/proj_unknown/jwks", keys: &signingKeys{}, status: http.StatusNotFound},
		{name: "a tenant that is no project ID", path: "/oauth/evil/jwks", keys: &signingKeys{}, status: http.StatusNotFound},
		{
			name:   "the platform project's ID as a tenant",
			path:   "/oauth/" + domain.PlatformProjectID + "/jwks",
			keys:   &signingKeys{keys: map[string][]jose.JSONWebKey{domain.PlatformProjectID: {key}}},
			status: http.StatusNotFound,
		},
		{name: "a fault reading the keys", path: "/oauth/proj_app/jwks", keys: &signingKeys{err: domain.ErrUnavailable()}, status: http.StatusInternalServerError},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			rec := send(t, newMux(t, Config{SigningKeys: tt.keys, PlatformEnabled: true}), http.MethodGet, tt.path, "api.example.com", https)
			assert.Equal(t, tt.status, rec.Code)
			assert.Equal(t, "no-store", rec.Header().Get("Cache-Control"), "a refusal is never cached")
		})
	}
}
