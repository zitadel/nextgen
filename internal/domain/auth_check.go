package domain

import "time"

type AuthCheck struct {
	Type AuthCheckType
	// When the check was initiated, it must be set by the storage and is read only.
	InitiatedAt time.Time
	// When the check was verified successfully, it must be set by the storage and is read only.
	VerifiedAt time.Time
	// When the check last failed. It must be set by the storage and is read only.
	// The repository MUST provide a method to set it to the current time, and to reset it to nil after a successful verification.
	LastFailedAt *time.Time
	// Times the check failed.
	// The value is read only. Use increment and reset functions of the repository to modify it.
	FailureCount uint16
}

type AuthCheckType uint8

const (
	AuthCheckTypeUnspecified AuthCheckType = iota
	AuthCheckTypeUser
	AuthCheckTypePassword
	AuthCheckTypePasskey
	AuthCheckIdentityProvider
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
	IsFactor()
	FactorPayload() any
}

type AuthChallenger interface {
	IsChallenge()
	ChallengePayload() any
}
