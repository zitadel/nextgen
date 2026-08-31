package domain

import (
	"time"
)

//go:generate go tool enumer -type=AuthCheckType -trimprefix=AuthCheckType -text -linecomment
type AuthCheckType uint8

const (
	AuthCheckTypeUnspecified AuthCheckType = iota
	AuthCheckTypeUser
	AuthCheckTypePassword
	AuthCheckTypePasskey
	AuthCheckTypePasskeyRegistration
)

// Class returns the factor class a check type competes in. Passkey
// enrollment proves the same thing an assertion does for that credential
// (ADR 056), so AuthCheckTypePasskeyRegistration shares the passkey class;
// every other type is its own class. Anything comparing "which kind of factor
// is this" — required-check matching, session merging, wire rendering —
// compares classes, not raw types.
func (t AuthCheckType) Class() AuthCheckType {
	if t == AuthCheckTypePasskeyRegistration {
		return AuthCheckTypePasskey
	}
	return t
}

type AuthCheck interface {
	Type() AuthCheckType
	Payload() any
}

type AuthFactor interface {
	AuthCheck
	GetLastVerifiedAt() time.Time
	SetLastVerifiedAt(lastVerifiedAt time.Time)
}

type AuthChallenge interface {
	AuthCheck
	SetID(id string)
	GetID() string
	GetLastChallengedAt() time.Time
	SetLastChallengedAt(lastChallengedAt time.Time)
	GetLastFailedAt() time.Time
	SetLastFailedAt(lastFailedAt time.Time)
	GetFailureCount() uint16
	SetFailureCount(failureCount uint16)
}

type authChallenge struct {
	ID               string    `json:"-"`
	LastChallengedAt time.Time `json:"-"`
	LastFailedAt     time.Time `json:"-"`
	FailureCount     uint16    `json:"-"`
}

func (a *authChallenge) SetID(id string) {
	a.ID = id
}

func (a *authChallenge) GetID() string {
	return a.ID
}

func (a *authChallenge) GetLastChallengedAt() time.Time {
	return a.LastChallengedAt
}

func (a *authChallenge) SetLastChallengedAt(lastChallengedAt time.Time) {
	a.LastChallengedAt = lastChallengedAt
}

func (a *authChallenge) GetLastFailedAt() time.Time {
	return a.LastFailedAt
}

func (a *authChallenge) SetLastFailedAt(lastFailedAt time.Time) {
	a.LastFailedAt = lastFailedAt
}

func (a *authChallenge) GetFailureCount() uint16 {
	return a.FailureCount
}

func (a *authChallenge) SetFailureCount(failureCount uint16) {
	a.FailureCount = failureCount
}

type authFactor struct {
	LastVerifiedAt time.Time `json:"-"`
}

func (a *authFactor) GetLastVerifiedAt() time.Time {
	return a.LastVerifiedAt
}

func (a *authFactor) SetLastVerifiedAt(lastVerifiedAt time.Time) {
	a.LastVerifiedAt = lastVerifiedAt
}
