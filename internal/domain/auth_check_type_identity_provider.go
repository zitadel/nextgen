package domain

type IdentityProviderAuthCheck struct {
	*AuthCheck
}

// Check implements [AuthChecker].
func (a *IdentityProviderAuthCheck) Check() *AuthCheck {
	return a.AuthCheck
}

var _ AuthChecker = (*IdentityProviderAuthCheck)(nil)
