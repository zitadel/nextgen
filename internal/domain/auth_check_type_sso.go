package domain

import "time"

// AuthFactorSso records that an external identity provider verified the user in
// this attempt. It is factor-only: the redirect out to the provider is the
// challenge, so there is no challenge half to record -- only the proof that
// came back. Provider and Subject are the same pair carried on the flow state's
// verified identity, persisted here so the attempt keeps a durable record of
// which provider vouched and for whom, independent of the sealed flow cookie.
type AuthFactorSso struct {
	Provider string
	Subject  string
	authFactor
}

func (a *AuthFactorSso) Type() AuthCheckType {
	return AuthCheckTypeSso
}

func (a *AuthFactorSso) Payload() any {
	return a
}

func SetAuthFactorSso(lastVerifiedAt time.Time) *AuthFactorSso {
	return &AuthFactorSso{
		authFactor: authFactor{
			LastVerifiedAt: lastVerifiedAt,
		},
	}
}

var _ AuthFactor = (*AuthFactorSso)(nil)
