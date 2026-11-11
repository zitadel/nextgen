package domain

import "time"

type AuthChallengePasskey struct {
	*PasskeyChallenge
	authChallenge
}

func (a *AuthChallengePasskey) Type() AuthCheckType {
	return AuthCheckTypePasskey
}

func (a *AuthChallengePasskey) Payload() any {
	return a
}

func SetAuthChallengePasskey(id string, lastChallengedAt, lastFailedAt time.Time, failureCount uint16) *AuthChallengePasskey {
	return &AuthChallengePasskey{
		PasskeyChallenge: new(PasskeyChallenge),
		authChallenge: authChallenge{
			ID:               id,
			LastChallengedAt: lastChallengedAt,
			LastFailedAt:     lastFailedAt,
			FailureCount:     failureCount,
		},
	}
}

type AuthFactorPasskey struct {
	UserVerified   bool
	UserID         string
	CredentialID   []byte
	BackupEligible bool
	BackupState    bool
	authFactor
}

func SetAuthFactorPasskey(lastVerifiedAt time.Time) *AuthFactorPasskey {
	return &AuthFactorPasskey{
		authFactor: authFactor{
			LastVerifiedAt: lastVerifiedAt,
		},
	}
}

func (a *AuthFactorPasskey) Type() AuthCheckType {
	return AuthCheckTypePasskey
}

func (a *AuthFactorPasskey) Payload() any {
	return a
}

type AuthChallengePasskeyRegistration struct {
	*PasskeyRegistrationChallenge
	// Provisional is true when the challenge minted the user handle itself:
	// the user row does not exist yet and is created when the attestation is
	// verified.
	Provisional bool
	authChallenge
}

func (a *AuthChallengePasskeyRegistration) Type() AuthCheckType {
	return AuthCheckTypePasskeyRegistration
}

func (a *AuthChallengePasskeyRegistration) Payload() any {
	return a
}

func SetAuthChallengePasskeyRegistration(id string, lastChallengedAt, lastFailedAt time.Time, failureCount uint16) *AuthChallengePasskeyRegistration {
	return &AuthChallengePasskeyRegistration{
		PasskeyRegistrationChallenge: new(PasskeyRegistrationChallenge),
		authChallenge: authChallenge{
			ID:               id,
			LastChallengedAt: lastChallengedAt,
			LastFailedAt:     lastFailedAt,
			FailureCount:     failureCount,
		},
	}
}

// AuthFactorPasskeyRegistration records a completed passkey enrollment on the
// attempt. It merges into the session as a passkey-class factor: creating the
// credential with user verification proves possession and presence just like
// an assertion does for that credential.
type AuthFactorPasskeyRegistration struct {
	UserVerified bool
	UserID       string
	// CredentialID is base64url-encoded ([EncodePasskeyCredentialID]).
	CredentialID   string
	BackupEligible bool
	BackupState    bool
	// PasskeyID and Name identify the persisted credential row, so callers of
	// the verify transaction can answer with the created passkey without a
	// read-back that could fail after the ceremony is already consumed.
	PasskeyID string
	Name      string
	authFactor
}

func SetAuthFactorPasskeyRegistration(lastVerifiedAt time.Time) *AuthFactorPasskeyRegistration {
	return &AuthFactorPasskeyRegistration{
		authFactor: authFactor{
			LastVerifiedAt: lastVerifiedAt,
		},
	}
}

func (a *AuthFactorPasskeyRegistration) Type() AuthCheckType {
	return AuthCheckTypePasskeyRegistration
}

func (a *AuthFactorPasskeyRegistration) Payload() any {
	return a
}

var (
	_ AuthChallenge = (*AuthChallengePasskey)(nil)
	_ AuthFactor    = (*AuthFactorPasskey)(nil)
	_ AuthChallenge = (*AuthChallengePasskeyRegistration)(nil)
	_ AuthFactor    = (*AuthFactorPasskeyRegistration)(nil)
)
