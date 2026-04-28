package domain

type UserAuthCheck struct {
	*AuthCheck
	Factor *UserFactor
}

type UserFactor struct {
	UserID string
}

// Check implements [AuthChecker].
func (a UserAuthCheck) Check() *AuthCheck {
	return a.AuthCheck
}

type UserAuthCheckFactor struct {
	UserID string
}

// IsFactor implements [AuthFactorer].
func (u *UserAuthCheck) IsFactor() {}

func (a UserAuthCheck) FactorPayload() any {
	return a.Factor
}

var (
	_ AuthChecker  = (*UserAuthCheck)(nil)
	_ AuthFactorer = (*UserAuthCheck)(nil)
)
