package domain

import "time"

func NewPasskeyAuthCheckChallenge(passkeyChallenge *PasskeyChallenge) (*AuthChallengePasskey, error) {
	challenge, err := newChallenge()
	if err != nil {
		return nil, err
	}
	// TODO: ?
	return &AuthChallengePasskey{
		PasskeyChallenge: passkeyChallenge,
		authChallenge:    challenge,
	}, nil
}

type AuthFactorPasskey struct {
	UserVerified bool
	*authFactor
}

func NewAuthFactorPasskey(lastVerifiedAt time.Time) *AuthFactorPasskey {
	return &AuthFactorPasskey{
		authFactor: &authFactor{
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

type AuthChallengePasskey struct {
	*PasskeyChallenge
	authChallenge
}

func NewAuthChallengePasskey(id string, lastChallengedAt, lastFailedAt time.Time, failureCount uint16) *AuthChallengePasskey {
	return &AuthChallengePasskey{
		authChallenge: authChallenge{
			ID:               id,
			LastChallengedAt: lastChallengedAt,
			LastFailedAt:     lastFailedAt,
			FailureCount:     failureCount,
		},
	}
}

func (a *AuthChallengePasskey) Type() AuthCheckType {
	return AuthCheckTypePasskey
}

func (a *AuthChallengePasskey) Payload() any {
	return a
}

var (
	_ AuthChallenge = (*AuthChallengePasskey)(nil)
	_ AuthFactor    = (*AuthFactorPasskey)(nil)
)
