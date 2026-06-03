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

var (
	_ AuthChallenge = (*AuthChallengePasskey)(nil)
	_ AuthFactor    = (*AuthFactorPasskey)(nil)
)
