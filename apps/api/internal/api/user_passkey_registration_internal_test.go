package api

import (
	"net/url"
	"testing"

	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

func beginRegistrationRequest(rpID string) api.BeginUserPasskeyRegistrationRequest {
	return api.BeginUserPasskeyRegistrationRequest{
		RpID:      rpID,
		RpOrigins: []url.URL{{Scheme: "https", Host: "example.com"}},
	}
}

// The contract states the relying party IDs WebAuthn accepts, so a client
// reads the rule from the spec and a valid request is never refused with a 400.
// Every ID the pattern lets through must start a ceremony.
func TestBeginUserPasskeyRegistrationRPIDPatternAcceptsOnlyWhatWebAuthnDoes(t *testing.T) {
	for _, rpID := range []string{"example.com", "login.example.co.uk", "a.b", "localhost", "xn--e1afmkfd.xn--p1ai", "my-site.example.com", "ex_ample.com", "0.com", "a"} {
		t.Run(rpID, func(t *testing.T) {
			request := beginRegistrationRequest(rpID)
			_, err := domain.CreatePasskeyRegistrationChallenge("usr_1", "user", "User", nil, rpID, request.RpOrigins)
			if rpID == "a" {
				require.Error(t, err, "a single label other than localhost is not an RP ID")
				require.Error(t, request.Validate())
				return
			}
			require.NoError(t, err, "fixture is not an ID WebAuthn accepts")
			require.NoError(t, request.Validate(), "the contract pattern rejects an ID the server accepts")
		})
	}
}

// What WebAuthn refuses, the pattern refuses first, so the request is invalid
// in the contract and not only at the server.
func TestBeginUserPasskeyRegistrationRPIDPatternRejectsWhatWebAuthnRefuses(t *testing.T) {
	for _, rpID := range []string{"0", "1.2", "127.0.0.1", "example.123", "-a.com", "a-.com", "a b.com", "a..com", "https://example.com", "example.com:8080", "example.com/x"} {
		t.Run(rpID, func(t *testing.T) {
			request := beginRegistrationRequest(rpID)
			_, err := domain.CreatePasskeyRegistrationChallenge("usr_1", "user", "User", nil, rpID, request.RpOrigins)
			require.Error(t, err, "fixture is an ID WebAuthn accepts")
			require.Error(t, request.Validate())
		})
	}
}
