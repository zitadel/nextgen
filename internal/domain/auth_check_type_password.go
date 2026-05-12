package domain

type PasswordAuthCheck struct {
	*AuthCheck
}

// Check implements [AuthFactorer].
func (p *PasswordAuthCheck) Check() *AuthCheck {
	return p.AuthCheck
}

// ChallengePayload implements [AuthChallenger].
func (p *PasswordAuthCheck) ChallengePayload() any {
	return nil
}

// IsChallenge implements [AuthChallenger].
func (p *PasswordAuthCheck) IsChallenge() {}

// FactorPayload implements [AuthFactorer].
func (p *PasswordAuthCheck) FactorPayload() any {
	return nil
}

// IsFactor implements [AuthFactorer].
func (p *PasswordAuthCheck) IsFactor() {}

var (
	_ AuthChecker    = (*PasswordAuthCheck)(nil)
	_ AuthChallenger = (*PasswordAuthCheck)(nil)
	_ AuthFactorer   = (*PasswordAuthCheck)(nil)
)
