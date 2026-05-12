package domain

type IdentityProviderAuthCheck struct {
	*AuthCheck
}

// Check implements [AuthChecker].
func (a *IdentityProviderAuthCheck) Check() *AuthCheck {
	return a.AuthCheck
}

// FactorPayload implements [AuthFactorer].
func (a *IdentityProviderAuthCheck) FactorPayload() any {
	return nil
}

// IsFactor implements [AuthFactorer].
func (a *IdentityProviderAuthCheck) IsFactor() {}

var (
	_ AuthChecker  = (*IdentityProviderAuthCheck)(nil)
	_ AuthFactorer = (*IdentityProviderAuthCheck)(nil)
)
