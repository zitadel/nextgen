package domain

type PasswordAuthCheck struct {
	*AuthCheck
}

var _ AuthChecker = (*PasswordAuthCheck)(nil)
