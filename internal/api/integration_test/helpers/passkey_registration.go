package helpers

import (
	"net/url"
	"testing"

	"github.com/descope/virtualwebauthn"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// PasskeyRelyingParty is the relying party [Harness.RegisterPasskey] registers
// against. Tests that drive the ceremony themselves should use the same values,
// so the attestation origin matches what the issued challenge was given.
var PasskeyRelyingParty = virtualwebauthn.RelyingParty{
	ID:     "example.com",
	Name:   "example.com",
	Origin: "https://example.com",
}

// RegisterPasskey runs a full registration ceremony through the auth attempt
// machinery and leaves one credential behind for the user, named passkeyName.
// The user factor is pinned on the attempt first, so the ceremony targets the
// existing user and excludes credentials already registered for it — hence a
// fresh virtual authenticator per call.
func (h *Harness) RegisterPasskey(t *testing.T, projectID, userID, passkeyName string) {
	t.Helper()

	svc := h.EnsureAuthAttemptService(t)
	rp := PasskeyRelyingParty
	origin, err := url.Parse(rp.Origin)
	require.NoError(t, err)

	attempt, err := svc.Create(t.Context(), service.CreateAuthAttemptInput{ProjectID: projectID})
	require.NoError(t, err)
	_, err = h.EnsureServiceDB(t).Statements().SetAuthAttemptFactor(
		t.Context(), projectID, attempt.ID, &domain.AuthFactorUser{UserID: userID})
	require.NoError(t, err)

	issued, err := svc.IssueChallenge(t.Context(), service.IssueChallengeInput{
		ProjectID: projectID,
		AttemptID: attempt.ID,
		Challenge: service.PasskeyRegistrationChallenge{
			UserID:      userID,
			Username:    "username",
			DisplayName: "Test User",
			RPID:        rp.ID,
			RPOrigins:   []url.URL{*origin},
		},
	})
	require.NoError(t, err)
	check, ok := issued.ChallengeByType(domain.AuthCheckTypePasskeyRegistration)
	require.True(t, ok)
	registrationCh, ok := check.(*domain.AuthChallengePasskeyRegistration)
	require.True(t, ok)
	options, err := domain.BuildPasskeyCreationOptions(registrationCh)
	require.NoError(t, err)

	authenticator := virtualwebauthn.NewAuthenticatorWithOptions(virtualwebauthn.AuthenticatorOptions{
		UserHandle: []byte(userID),
	})
	credential := virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2)
	authenticator.AddCredential(credential)

	attestationOptions, err := virtualwebauthn.ParseAttestationOptions(string(options))
	require.NoError(t, err)
	attestation := virtualwebauthn.CreateAttestationResponse(rp, authenticator, credential, *attestationOptions)

	_, err = svc.VerifyProof(t.Context(), service.VerifyProofInput{
		ProjectID:   projectID,
		AttemptID:   attempt.ID,
		ChallengeID: check.GetID(),
		Proof: service.PasskeyRegistrationProof{
			AttestationResponse: []byte(attestation),
			Name:                passkeyName,
		},
	})
	require.NoError(t, err)
}
