package domain

import "time"

type AuthChallengePassword struct {
	authChallenge
}

func NewAuthChallengePassword(id string, lastChallengedAt, lastFailedAt time.Time, failureCount uint16) *AuthChallengePassword {
	return &AuthChallengePassword{
		authChallenge: authChallenge{
			ID:               id,
			LastChallengedAt: lastChallengedAt,
			LastFailedAt:     lastFailedAt,
			FailureCount:     failureCount,
		},
	}
}

func NewPasswordAuthCheck() (*AuthChallengePassword, error) {
	challenge, err := newChallenge()
	if err != nil {
		return nil, err
	}
	return &AuthChallengePassword{
		authChallenge: challenge,
	}, nil
}

func (a *AuthChallengePassword) Type() AuthCheckType {
	return AuthCheckTypePassword
}

func (a *AuthChallengePassword) Payload() any {
	return nil
}

type AuthFactorPassword struct {
	authFactor
}

func NewAuthFactorPassword(lastVerifiedAt time.Time) *AuthFactorPassword {
	return &AuthFactorPassword{
		authFactor: authFactor{
			LastVerifiedAt: lastVerifiedAt,
		},
	}
}

func (a *AuthFactorPassword) Type() AuthCheckType {
	return AuthCheckTypePassword
}

func (a *AuthFactorPassword) Payload() any {
	return nil
}

var (
	_ AuthChallenge = (*AuthChallengePassword)(nil)
	_ AuthFactor    = (*AuthFactorPassword)(nil)
)
