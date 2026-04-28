package domain

type AuthAttemptCheckIdentityProvider struct {
	*AuthCheck
}

// Check implements [AuthChecker].
func (a *AuthAttemptCheckIdentityProvider) Check() *AuthCheck {
	return a.AuthCheck
}

var _ AuthChecker = (*AuthAttemptCheckIdentityProvider)(nil)
