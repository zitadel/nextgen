package api

import (
	"encoding/base64"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

func checksToAPI(checks []domain.AuthCheck) ([]api.CompletedFactor, []api.ChallengeResponse) {
	factors := make([]api.CompletedFactor, 0, len(checks))
	challenges := make([]api.ChallengeResponse, 0, len(checks))
	for _, check := range checks {
		switch c := check.(type) {
		case domain.AuthFactor:
			factors = append(factors, factorToAPI(c))
		case domain.AuthChallenge:
			challenges = append(challenges, *challengeToAPI(c))
		}
	}
	return factors, challenges
}

func factorToAPI(factor domain.AuthFactor) api.CompletedFactor {
	resp := api.CompletedFactor{
		Method:     checkTypeToAPI(factor.Type()),
		VerifiedAt: factor.GetLastVerifiedAt(),
		Payload:    factorPayloadToAPI(factor),
	}
	return resp
}

func factorPayloadToAPI(factor domain.AuthFactor) api.OptCompletedFactorPayload {
	switch f := factor.(type) {
	case *domain.AuthFactorUser:
		return api.NewOptCompletedFactorPayload(api.CompletedFactorPayload{
			Type: api.IdentifierFactorPayloadCompletedFactorPayload,
			IdentifierFactorPayload: api.IdentifierFactorPayload{
				UserID: api.UserID(f.UserID),
			},
		})
	case *domain.AuthFactorPassword:
		return api.NewOptCompletedFactorPayload(api.CompletedFactorPayload{
			Type:                  api.PasswordFactorPayloadCompletedFactorPayload,
			PasswordFactorPayload: api.PasswordFactorPayload{},
		})
	case *domain.AuthFactorPasskey:
		return api.NewOptCompletedFactorPayload(api.CompletedFactorPayload{
			Type: api.PasskeyFactorPayloadCompletedFactorPayload,
			PasskeyFactorPayload: api.PasskeyFactorPayload{
				CredentialID:            base64.RawURLEncoding.EncodeToString(f.CredentialID),
				UserVerified:            f.UserVerified,
				BackupEligible:          api.NewOptBool(f.BackupEligible),
				BackupState:             api.NewOptBool(f.BackupState),
				AuthenticatorAttachment: api.OptPasskeyFactorPayloadAuthenticatorAttachment{},
			},
		})
	case *domain.AuthFactorPasskeyRegistration:
		// A completed enrollment renders as a passkey factor: creating the
		// credential proved possession just like an assertion would.
		return api.NewOptCompletedFactorPayload(api.CompletedFactorPayload{
			Type: api.PasskeyFactorPayloadCompletedFactorPayload,
			PasskeyFactorPayload: api.PasskeyFactorPayload{
				CredentialID:            f.CredentialID,
				UserVerified:            f.UserVerified,
				BackupEligible:          api.NewOptBool(f.BackupEligible),
				BackupState:             api.NewOptBool(f.BackupState),
				AuthenticatorAttachment: api.OptPasskeyFactorPayloadAuthenticatorAttachment{},
			},
		})
	}
	return api.OptCompletedFactorPayload{}
}

func requiredFactorsToAPI(checks []domain.AuthCheckType) []api.FactorMethod {
	factors := make([]api.FactorMethod, len(checks))
	for i, check := range checks {
		factors[i] = checkTypeToAPI(check)
	}
	return factors
}

func checkTypeToAPI(check domain.AuthCheckType) api.FactorMethod {
	switch check {
	case domain.AuthCheckTypeUser:
		return api.FactorMethodIdentifier
	case domain.AuthCheckTypePassword:
		return api.FactorMethodPassword
	case domain.AuthCheckTypePasskey:
		return api.FactorMethodPasskey
	case domain.AuthCheckTypePasskeyRegistration:
		// Enrollment is passkey-class on the wire; the distinct check type is
		// internal bookkeeping.
		return api.FactorMethodPasskey
	default:
		return ""
	}
}
