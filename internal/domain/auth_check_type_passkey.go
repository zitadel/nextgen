package domain

import "time"

type PasskeyAuthCheck struct {
	*AuthCheck
	Challenge *PasskeyAuthCheckChallenge
	Factor    *PasskeyAuthCheckFactor
}

type PasskeyAuthCheckChallenge struct {
	LastChallengedAt     time.Time
	Challenge            string
	AllowedCredentialIDs [][]byte
	UserVerification     uint8 // domain.UserVerificationRequirement
	RPID                 string
}

type PasskeyAuthCheckFactor struct {
	UserVerified bool
}

// FactorPayload implements [AuthFactorer].
func (p *PasskeyAuthCheck) FactorPayload() any {
	return p.Factor
}

// IsFactor implements [AuthFactorer].
func (p *PasskeyAuthCheck) IsFactor() {}

// ChallengePayload implements [AuthChallenger].
func (p *PasskeyAuthCheck) ChallengePayload() any {
	return p.Challenge
}

// IsChallenge implements [AuthChallenger].
func (p *PasskeyAuthCheck) IsChallenge() {}

var (
	_ AuthChecker    = (*PasskeyAuthCheck)(nil)
	_ AuthChallenger = (*PasskeyAuthCheck)(nil)
	_ AuthFactorer   = (*PasskeyAuthCheck)(nil)
)
