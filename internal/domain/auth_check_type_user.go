package domain

import "time"

type AuthChallengeUser struct {
	authChallenge
}

func (a *AuthChallengeUser) Type() AuthCheckType {
	return AuthCheckTypeUser
}

func (a *AuthChallengeUser) Payload() any {
	return nil
}

func (a *AuthFactorUser) Type() AuthCheckType {
	return AuthCheckTypeUser
}

func (a *AuthFactorUser) Payload() any {
	return a
}

func NewAuthChallengeUser(id string, lastChallengedAt, lastFailedAt time.Time, failureCount uint16) *AuthChallengeUser {
	return &AuthChallengeUser{
		authChallenge: authChallenge{
			ID:               id,
			LastChallengedAt: lastChallengedAt,
			LastFailedAt:     lastFailedAt,
			FailureCount:     failureCount,
		},
	}
}

func NewUserAuthCheck() (*AuthChallengeUser, error) {
	challenge, err := newChallenge()
	if err != nil {
		return nil, err
	}
	return &AuthChallengeUser{
		authChallenge: challenge,
	}, nil
}

type AuthFactorUser struct {
	UserID string
	authFactor
}

func NewAuthFactorUser(userID string, lastVerifiedAt time.Time) *AuthFactorUser {
	return &AuthFactorUser{
		UserID: userID,
		authFactor: authFactor{
			LastVerifiedAt: lastVerifiedAt,
		},
	}
}

var (
	_ AuthChallenge = (*AuthChallengeUser)(nil)
	_ AuthFactor    = (*AuthFactorUser)(nil)
)
