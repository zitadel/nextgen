package domain

import "time"

type AuthFactorIdentityProvider struct {
	*authFactor
}

func NewAuthFactorIdentityProvider(lastVerifiedAt time.Time) *AuthFactorIdentityProvider {
	return &AuthFactorIdentityProvider{
		authFactor: &authFactor{
			LastVerifiedAt: lastVerifiedAt,
		},
	}
}

func (a *AuthFactorIdentityProvider) Type() AuthCheckType {
	return AuthCheckTypeIdentityProvider
}

func (a *AuthFactorIdentityProvider) Payload() any {
	return a
}

type AuthChallengeIdentityProvider struct {
	authChallenge
}

func NewAuthChallengeIdentityProvider(id string, lastChallengedAt, lastFailedAt time.Time, failureCount uint16) *AuthChallengeIdentityProvider {
	return &AuthChallengeIdentityProvider{
		authChallenge: authChallenge{
			ID:               id,
			LastChallengedAt: lastChallengedAt,
			LastFailedAt:     lastFailedAt,
			FailureCount:     failureCount,
		},
	}
}

func (a *AuthChallengeIdentityProvider) Type() AuthCheckType {
	return AuthCheckTypeIdentityProvider
}

func (a *AuthChallengeIdentityProvider) Payload() any {
	return nil
}

var (
	_ AuthChallenge = (*AuthChallengeIdentityProvider)(nil)
	_ AuthFactor    = (*AuthFactorIdentityProvider)(nil)
)
