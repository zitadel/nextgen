package domain

import "time"

type AuthChallengePasskey struct {
	*PasskeyCeremony
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
		PasskeyCeremony: &PasskeyCeremony{},
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
	*PasskeyCeremony
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
		PasskeyCeremony: &PasskeyCeremony{},
		authChallenge: authChallenge{
			ID:               id,
			LastChallengedAt: lastChallengedAt,
			LastFailedAt:     lastFailedAt,
			FailureCount:     failureCount,
		},
	}
}

var (
	_ AuthChallenge = (*AuthChallengePasskey)(nil)
	_ AuthFactor    = (*AuthFactorPasskey)(nil)
	_ AuthChallenge = (*AuthChallengePasskeyRegistration)(nil)
)
