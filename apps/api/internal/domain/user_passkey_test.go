package domain_test

import (
	"encoding/base64"
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

// passkeyTestSetup wires a virtual authenticator holding a single credential and the matching
// stored domain.UserPasskey, so tests can drive a real challenge -> signed assertion -> verify
// round-trip against the go-webauthn library.
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
	// Counter is the sign count reported by the authenticator in the signed assertion. Keeping
	// the stored count below it (0) avoids a clone warning and lets us assert the new value.
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

// assertionFor builds a signed assertion response for the given challenge, as a real client
// authenticator would produce after the browser is handed the challenge.
func (s passkeyTestSetup) assertionFor(t *testing.T, challenge *domain.PasskeyChallenge) []byte {
	t.Helper()

	rawChallenge, err := base64.RawURLEncoding.DecodeString(challenge.Challenge)
	require.NoError(t, err)

	allowed := make([]string, 0, len(challenge.AllowedCredentialIDs))
	for _, id := range challenge.AllowedCredentialIDs {
		allowed = append(allowed, base64.RawURLEncoding.EncodeToString(id))
	}

	opts := virtualwebauthn.AssertionOptions{
		Challenge:        rawChallenge,
		RelyingPartyID:   challenge.RPID,
		AllowCredentials: allowed,
	}
	return []byte(virtualwebauthn.CreateAssertionResponse(s.rp, s.auth, s.cred, opts))
}

func TestCreatePasskeyChallenge(t *testing.T) {
	t.Run("identified login populates the challenge", func(t *testing.T) {
		s := newPasskeyTestSetup(t)

		challenge, err := domain.CreatePasskeyChallenge(testUserID, []*domain.UserPasskey{s.passkey}, "preferred", testRPID, s.origins)
		require.NoError(t, err)

		assert.NotEmpty(t, challenge.Challenge)
		assert.Equal(t, testRPID, challenge.RPID)
		assert.Equal(t, s.origins, challenge.RPOrigins)
		assert.Equal(t, "preferred", challenge.UserVerification)
		require.Len(t, challenge.AllowedCredentialIDs, 1)
		assert.Equal(t, s.cred.ID, challenge.AllowedCredentialIDs[0])
		assert.Equal(t, []byte(testUserID), challenge.UserID)
	})

	t.Run("discoverable login has no allowed credentials", func(t *testing.T) {
		s := newPasskeyTestSetup(t)

		challenge, err := domain.CreatePasskeyChallenge("", nil, "", testRPID, s.origins)
		require.NoError(t, err)

		assert.NotEmpty(t, challenge.Challenge)
		assert.Empty(t, challenge.AllowedCredentialIDs)
	})
}

func TestVerifyPasskeyChallenge(t *testing.T) {
	t.Run("verifies a valid assertion", func(t *testing.T) {
		s := newPasskeyTestSetup(t)

		challenge, err := domain.CreatePasskeyChallenge(testUserID, []*domain.UserPasskey{s.passkey}, "preferred", testRPID, s.origins)
		require.NoError(t, err)

		assertion := s.assertionFor(t, challenge)
		verification, err := domain.VerifyPasskeyChallenge(challenge, assertion, testUserID, []*domain.UserPasskey{s.passkey}, nil)
		require.NoError(t, err)

		assert.Equal(t, s.cred.ID, verification.CredentialID)
		assert.Equal(t, uint32(1), verification.SignCount)
		assert.True(t, verification.UserVerified)
		assert.Equal(t, testUserID, verification.UserID, "identified login must carry the known user")
	})

	t.Run("verifies a discoverable (usernameless) assertion", func(t *testing.T) {
		s := newPasskeyTestSetup(t)

		// No user is identified up front: the challenge is issued discoverable and the user is
		// resolved from the authenticator's user handle during verification.
		challenge, err := domain.CreatePasskeyChallenge("", nil, "", testRPID, s.origins)
		require.NoError(t, err)

		assertion := s.assertionFor(t, challenge)
		lookupCalls := 0
		lookup := func(userHandle string) ([]*domain.UserPasskey, error) {
			lookupCalls++
			assert.Equal(t, testUserID, userHandle, "user handle should resolve to the credential's user")
			return []*domain.UserPasskey{s.passkey}, nil
		}

		verification, err := domain.VerifyPasskeyChallenge(challenge, assertion, "", nil, lookup)
		require.NoError(t, err)

		assert.Equal(t, 1, lookupCalls, "discoverable login must resolve the user via the lookup")
		assert.Equal(t, s.cred.ID, verification.CredentialID)
		assert.Equal(t, testUserID, verification.UserID)
		assert.True(t, verification.UserVerified)
	})

	t.Run("discoverable login propagates the user lookup error", func(t *testing.T) {
		s := newPasskeyTestSetup(t)

		challenge, err := domain.CreatePasskeyChallenge("", nil, "", testRPID, s.origins)
		require.NoError(t, err)

		assertion := s.assertionFor(t, challenge)
		lookupErr := errors.New("user lookup failed")
		lookup := func(string) ([]*domain.UserPasskey, error) {
			return nil, lookupErr
		}

		_, err = domain.VerifyPasskeyChallenge(challenge, assertion, "", nil, lookup)
		assert.Error(t, err)
	})

	t.Run("rejects garbage assertion bytes", func(t *testing.T) {
		s := newPasskeyTestSetup(t)

		challenge, err := domain.CreatePasskeyChallenge(testUserID, []*domain.UserPasskey{s.passkey}, "preferred", testRPID, s.origins)
		require.NoError(t, err)

		_, err = domain.VerifyPasskeyChallenge(challenge, []byte("not-a-valid-assertion"), testUserID, []*domain.UserPasskey{s.passkey}, nil)
		assert.Error(t, err)
	})

	t.Run("rejects assertion with mismatched origin", func(t *testing.T) {
		s := newPasskeyTestSetup(t)

		challenge, err := domain.CreatePasskeyChallenge(testUserID, []*domain.UserPasskey{s.passkey}, "preferred", testRPID, s.origins)
		require.NoError(t, err)

		// Sign the assertion against a different origin than the one the challenge was issued for.
		s.rp.Origin = "https://attacker.example"
		assertion := s.assertionFor(t, challenge)

		_, err = domain.VerifyPasskeyChallenge(challenge, assertion, testUserID, []*domain.UserPasskey{s.passkey}, nil)
		assert.Error(t, err)
	})
}

func TestPasskeyCredentialName(t *testing.T) {
	tests := []struct {
		name           string
		transports     []string
		backupEligible bool
		want           string
	}{
		{
			name:           "roaming transport is a security key",
			transports:     []string{"usb", "nfc"},
			backupEligible: true,
			want:           domain.PasskeyNameSecurityKey,
		},
		{
			name:           "backup-eligible credential syncs",
			transports:     []string{"internal", "hybrid"},
			backupEligible: true,
			want:           domain.PasskeyNameSynced,
		},
		{
			name:       "platform credential without backup is device-bound",
			transports: []string{"internal"},
			want:       domain.PasskeyNameDeviceBound,
		},
		{
			name: "no transports reported still yields a name",
			want: domain.PasskeyNameDeviceBound,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, domain.GeneratePasskeyCredentialName(tt.transports, tt.backupEligible))
		})
	}
}
