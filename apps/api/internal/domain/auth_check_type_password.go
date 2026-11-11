package domain

import "time"

type AuthChallengePassword struct {
	authChallenge
}

func (a *AuthChallengePassword) Type() AuthCheckType {
	return AuthCheckTypePassword
}

func (a *AuthChallengePassword) Payload() any {
	return nil
}

func SetAuthChallengePassword(id string, lastChallengedAt, lastFailedAt time.Time, failureCount uint16) *AuthChallengePassword {
	return &AuthChallengePassword{
		authChallenge: authChallenge{
			ID:               id,
			LastChallengedAt: lastChallengedAt,
			LastFailedAt:     lastFailedAt,
			FailureCount:     failureCount,
		},
	}
}

type AuthFactorPassword struct {
	authFactor
}

func (a *AuthFactorPassword) Type() AuthCheckType {
	return AuthCheckTypePassword
}

func (a *AuthFactorPassword) Payload() any {
	return nil
}

func SetAuthFactorPassword(lastVerifiedAt time.Time) *AuthFactorPassword {
	return &AuthFactorPassword{
		authFactor: authFactor{
			LastVerifiedAt: lastVerifiedAt,
		},
	}
}

var (
	_ AuthChallenge = (*AuthChallengePassword)(nil)
	_ AuthFactor    = (*AuthFactorPassword)(nil)
)
