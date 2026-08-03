package helpers

import (
	"testing"

	"github.com/descope/virtualwebauthn"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Harness) EnsurePasskeyRegistrationService(t *testing.T) *service.PasskeyRegistrationService {
	t.Helper()
	return service.NewPasskeyRegistrationService(
		h.EnsureServiceDB(t),
	)
}

// PasskeyRelyingParty is the relying party [Harness.RegisterPasskey] registers
// against. Tests that drive the ceremony themselves should use the same values,
// so the attestation origin matches what Begin was given.
var PasskeyRelyingParty = virtualwebauthn.RelyingParty{
	ID:     "example.com",
	Name:   "example.com",
	Origin: "https://example.com",
}

// RegisterPasskey runs a full registration ceremony and leaves one credential
// behind for the user, named passkeyName. Finish verifies the attestation
// against the stored challenge, so this mints a real virtual authenticator — a
// fresh one per call, since Begin excludes the credentials already registered
// for the user.
func (h *Harness) RegisterPasskey(t *testing.T, projectID, userID, passkeyName string) {
	t.Helper()

	passkeyService := h.EnsurePasskeyRegistrationService(t)
	rp := PasskeyRelyingParty

	registration, err := passkeyService.Begin(t.Context(), service.BeginRegistrationInput{
		ProjectID:   projectID,
		UserID:      userID,
		Username:    "username",
		DisplayName: "Test User",
		RPID:        rp.ID,
		RPOrigins:   []string{rp.Origin},
	})
	require.NoError(t, err)

	authenticator := virtualwebauthn.NewAuthenticatorWithOptions(virtualwebauthn.AuthenticatorOptions{
		UserHandle: []byte(userID),
	})
	credential := virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2)
	authenticator.AddCredential(credential)

	attestationOptions, err := virtualwebauthn.ParseAttestationOptions(string(registration.Options))
	require.NoError(t, err)
	attestation := virtualwebauthn.CreateAttestationResponse(rp, authenticator, credential, *attestationOptions)

	err = passkeyService.Finish(t.Context(), service.FinishRegistrationInput{
		ProjectID:      projectID,
		RegistrationID: registration.RegistrationID,
		Attestation:    []byte(attestation),
		PasskeyName:    passkeyName,
	})
	require.NoError(t, err)
}
