package domain_test

import (
	"encoding/json"
	"errors"
	"net/url"
	"testing"

	"github.com/descope/virtualwebauthn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
)

const (
	testRPID    = "example.com"
	testOrigin  = "https://example.com"
	testUserID  = "user-1"
	testProject = "proj-1"
)

type passkeyTestSetup struct {
	rp      virtualwebauthn.RelyingParty
	auth    virtualwebauthn.Authenticator
	cred    virtualwebauthn.Credential
	passkey *domain.UserPasskey
	origins []url.URL
}

func newPasskeyTestSetup(t *testing.T) passkeyTestSetup {
	t.Helper()

	rp := virtualwebauthn.RelyingParty{ID: testRPID, Name: "Example", Origin: testOrigin}
	auth := virtualwebauthn.NewAuthenticatorWithOptions(virtualwebauthn.AuthenticatorOptions{
		UserHandle: []byte(testUserID),
	})
	cred := virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2)
	cred.Counter = 1
	auth.AddCredential(cred)

	origin, err := url.Parse(testOrigin)
	require.NoError(t, err)

	passkey := &domain.UserPasskey{
		ProjectID:    testProject,
		UserID:       testUserID,
		CredentialID: string(cred.ID),
		PublicKey:    cred.Key.AttestationData(),
		AAGUID:       auth.Aaguid[:],
		SignCount:    0,
	}

	return passkeyTestSetup{
		rp:      rp,
		auth:    auth,
		cred:    cred,
		passkey: passkey,
		origins: []url.URL{*origin},
	}
}

func TestPasskeyCeremony_JSONRoundTrip(t *testing.T) {
	s := newPasskeyTestSetup(t)

	ceremony, err := domain.CreatePasskeyChallenge(testUserID, []*domain.UserPasskey{s.passkey}, "preferred", testRPID, s.origins)
	require.NoError(t, err)
	require.NotEmpty(t, ceremony.ClientOptions())

	raw, err := json.Marshal(ceremony)
	require.NoError(t, err)
	assert.NotContains(t, string(raw), "client_options")

	var decoded domain.PasskeyCeremony
	require.NoError(t, json.Unmarshal(raw, &decoded))

	assert.JSONEq(t, string(ceremony.SessionData), string(decoded.SessionData))
	assert.Empty(t, decoded.ClientOptions())
	require.Len(t, decoded.RPOrigins, 1)
	assert.Equal(t, testOrigin, decoded.RPOrigins[0].String())
}

func TestCreatePasskeyChallenge(t *testing.T) {
	t.Run("identified login exposes parseable client options", func(t *testing.T) {
		s := newPasskeyTestSetup(t)

		ceremony, err := domain.CreatePasskeyChallenge(testUserID, []*domain.UserPasskey{s.passkey}, "preferred", testRPID, s.origins)
		require.NoError(t, err)

		opts, err := virtualwebauthn.ParseAssertionOptions(string(ceremony.ClientOptions()))
		require.NoError(t, err)
		assert.NotEmpty(t, opts.Challenge)
		assert.Equal(t, testRPID, opts.RelyingPartyID)
		require.Len(t, opts.AllowCredentials, 1)
	})

	t.Run("discoverable login has no allowed credentials", func(t *testing.T) {
		s := newPasskeyTestSetup(t)

		ceremony, err := domain.CreatePasskeyChallenge("", nil, "", testRPID, s.origins)
		require.NoError(t, err)

		opts, err := virtualwebauthn.ParseAssertionOptions(string(ceremony.ClientOptions()))
		require.NoError(t, err)
		assert.NotEmpty(t, opts.Challenge)
		assert.Empty(t, opts.AllowCredentials)
	})
}

func TestVerifyPasskeyChallenge(t *testing.T) {
	t.Run("verifies a valid assertion", func(t *testing.T) {
		s := newPasskeyTestSetup(t)

		ceremony, err := domain.CreatePasskeyChallenge(testUserID, []*domain.UserPasskey{s.passkey}, "preferred", testRPID, s.origins)
		require.NoError(t, err)

		assertion := s.assertionForCeremony(t, ceremony)
		verification, err := domain.VerifyPasskeyChallenge(ceremony, assertion, testUserID, []*domain.UserPasskey{s.passkey}, nil)
		require.NoError(t, err)

		assert.Equal(t, s.cred.ID, verification.CredentialID)
		assert.Equal(t, uint32(1), verification.SignCount)
		assert.True(t, verification.UserVerified)
		assert.Equal(t, testUserID, verification.UserID)
	})

	t.Run("verifies a discoverable assertion", func(t *testing.T) {
		s := newPasskeyTestSetup(t)

		ceremony, err := domain.CreatePasskeyChallenge("", nil, "", testRPID, s.origins)
		require.NoError(t, err)

		assertion := s.assertionForCeremony(t, ceremony)
		lookupCalls := 0
		lookup := func(userHandle string) ([]*domain.UserPasskey, error) {
			lookupCalls++
			assert.Equal(t, testUserID, userHandle)
			return []*domain.UserPasskey{s.passkey}, nil
		}

		verification, err := domain.VerifyPasskeyChallenge(ceremony, assertion, "", nil, lookup)
		require.NoError(t, err)

		assert.Equal(t, 1, lookupCalls)
		assert.Equal(t, s.cred.ID, verification.CredentialID)
		assert.Equal(t, testUserID, verification.UserID)
		assert.True(t, verification.UserVerified)
	})

	t.Run("discoverable login propagates the user lookup error", func(t *testing.T) {
		s := newPasskeyTestSetup(t)

		ceremony, err := domain.CreatePasskeyChallenge("", nil, "", testRPID, s.origins)
		require.NoError(t, err)

		assertion := s.assertionForCeremony(t, ceremony)
		lookupErr := errors.New("user lookup failed")
		lookup := func(string) ([]*domain.UserPasskey, error) {
			return nil, lookupErr
		}

		_, err = domain.VerifyPasskeyChallenge(ceremony, assertion, "", nil, lookup)
		assert.Error(t, err)
	})

	t.Run("rejects garbage assertion bytes", func(t *testing.T) {
		s := newPasskeyTestSetup(t)

		ceremony, err := domain.CreatePasskeyChallenge(testUserID, []*domain.UserPasskey{s.passkey}, "preferred", testRPID, s.origins)
		require.NoError(t, err)

		_, err = domain.VerifyPasskeyChallenge(ceremony, []byte("not-a-valid-assertion"), testUserID, []*domain.UserPasskey{s.passkey}, nil)
		assert.Error(t, err)
	})

	t.Run("rejects assertion with mismatched origin", func(t *testing.T) {
		s := newPasskeyTestSetup(t)

		ceremony, err := domain.CreatePasskeyChallenge(testUserID, []*domain.UserPasskey{s.passkey}, "preferred", testRPID, s.origins)
		require.NoError(t, err)

		s.rp.Origin = "https://attacker.example"
		assertion := s.assertionForCeremony(t, ceremony)

		_, err = domain.VerifyPasskeyChallenge(ceremony, assertion, testUserID, []*domain.UserPasskey{s.passkey}, nil)
		assert.Error(t, err)
	})
}

func TestCreatePasskeyRegistrationChallenge(t *testing.T) {
	s := newPasskeyTestSetup(t)

	ceremony, err := domain.CreatePasskeyRegistrationChallenge(testUserID, testUserID, testUserID, nil, testRPID, s.origins)
	require.NoError(t, err)

	opts, err := virtualwebauthn.ParseAttestationOptions(string(ceremony.ClientOptions()))
	require.NoError(t, err)
	assert.NotEmpty(t, opts.Challenge)
	assert.Equal(t, testRPID, opts.RelyingPartyID)
}

func TestVerifyPasskeyRegistrationChallenge(t *testing.T) {
	s := newPasskeyTestSetup(t)

	authNew := virtualwebauthn.NewAuthenticatorWithOptions(virtualwebauthn.AuthenticatorOptions{
		UserHandle: []byte(testUserID),
	})
	credNew := virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2)

	ceremony, err := domain.CreatePasskeyRegistrationChallenge(testUserID, testUserID, testUserID, nil, testRPID, s.origins)
	require.NoError(t, err)

	attestOpts, err := virtualwebauthn.ParseAttestationOptions(string(ceremony.ClientOptions()))
	require.NoError(t, err)
	attestation := []byte(virtualwebauthn.CreateAttestationResponse(s.rp, authNew, credNew, *attestOpts))

	passkey, err := domain.VerifyPasskeyRegistrationChallenge(ceremony, attestation)
	require.NoError(t, err)

	assert.Equal(t, testUserID, passkey.UserID)
	assert.NotEmpty(t, passkey.CredentialID)
	assert.NotEmpty(t, passkey.PublicKey)
}

func TestVerifyPasskeyChallenge_AfterPersistenceRoundTrip(t *testing.T) {
	s := newPasskeyTestSetup(t)

	ceremony, err := domain.CreatePasskeyChallenge(testUserID, []*domain.UserPasskey{s.passkey}, "preferred", testRPID, s.origins)
	require.NoError(t, err)

	assertion := s.assertionForCeremony(t, ceremony)

	raw, err := json.Marshal(ceremony)
	require.NoError(t, err)

	var stored domain.PasskeyCeremony
	require.NoError(t, json.Unmarshal(raw, &stored))

	verification, err := domain.VerifyPasskeyChallenge(&stored, assertion, testUserID, []*domain.UserPasskey{s.passkey}, nil)
	require.NoError(t, err)
	assert.Equal(t, s.cred.ID, verification.CredentialID)
}

func TestVerifyPasskeyRegistrationChallenge_AfterPersistenceRoundTrip(t *testing.T) {
	s := newPasskeyTestSetup(t)

	authNew := virtualwebauthn.NewAuthenticatorWithOptions(virtualwebauthn.AuthenticatorOptions{
		UserHandle: []byte(testUserID),
	})
	credNew := virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2)

	ceremony, err := domain.CreatePasskeyRegistrationChallenge(testUserID, testUserID, testUserID, nil, testRPID, s.origins)
	require.NoError(t, err)

	attestOpts, err := virtualwebauthn.ParseAttestationOptions(string(ceremony.ClientOptions()))
	require.NoError(t, err)
	attestation := []byte(virtualwebauthn.CreateAttestationResponse(s.rp, authNew, credNew, *attestOpts))

	raw, err := json.Marshal(ceremony)
	require.NoError(t, err)

	var stored domain.PasskeyCeremony
	require.NoError(t, json.Unmarshal(raw, &stored))

	passkey, err := domain.VerifyPasskeyRegistrationChallenge(&stored, attestation)
	require.NoError(t, err)
	assert.Equal(t, testUserID, passkey.UserID)
}

func (s passkeyTestSetup) assertionForCeremony(t *testing.T, ceremony *domain.PasskeyCeremony) []byte {
	t.Helper()

	opts, err := virtualwebauthn.ParseAssertionOptions(string(ceremony.ClientOptions()))
	require.NoError(t, err)
	return []byte(virtualwebauthn.CreateAssertionResponse(s.rp, s.auth, s.cred, *opts))
}
