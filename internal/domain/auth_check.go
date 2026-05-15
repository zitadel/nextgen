package domain

import "time"

type AuthCheck struct {
	Type AuthCheckType
	// When the check was verified successfully, it must be set by the storage and is read only.
	LastVerifiedAt time.Time
	// When the check was last challenged. It must be set by the storage and is read only.
	LastChallengedAt time.Time
	// When the check last failed. It must be set by the storage and is read only.
	// The repository MUST provide a method to set it to the current time, and to reset it to nil after a successful verification.
	LastFailedAt *time.Time
	// Times the check failed.
	// The value is read only. Use increment and reset functions of the repository to modify it.
	FailureCount uint16
}

//go:generate go tool enumer -type AuthCheckType -transform snake -trimprefix AuthCheckType
type AuthCheckType uint8

const (
	AuthCheckTypeUnspecified AuthCheckType = iota
	AuthCheckTypeUser
	AuthCheckTypePassword
	AuthCheckTypePasskey
	AuthCheckTypeIdentityProvider
)

func (a AuthCheck) IsType(typ AuthCheckType) bool {
	return a.Type == typ
}

// Check implements [AuthChecker].
func (a *AuthCheck) Check() *AuthCheck {
	return a
}

var _ AuthChecker = (*AuthCheck)(nil)

type AuthChecker interface {
	Check() *AuthCheck
}

type AuthFactorer interface {
	AuthChecker

	IsFactor()
	FactorPayload() any
}

type AuthChallenger interface {
	AuthChecker

	IsChallenge()
	ChallengePayload() any
}
