package domain

import (
	"time"
)

func newChallenge() (authChallenge, error) {
	id, err := newID(PrefixChallenge)
	if err != nil {
		return authChallenge{}, err
	}
	return authChallenge{
		ID: id,
	}, nil
}

type AuthCheckType uint8

const (
	AuthCheckTypeUnspecified AuthCheckType = iota
	AuthCheckTypeUser
	AuthCheckTypePassword
	AuthCheckTypePasskey
	AuthCheckTypeIdentityProvider
)

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
	GetID() string
	GetLastChallengedAt() time.Time
	SetLastChallengedAt(lastChallengedAt time.Time)
	GetLastFailedAt() time.Time
	SetLastFailedAt(lastFailedAt time.Time)
	GetFailureCount() uint16
	SetFailureCount(failureCount uint16)
}

type authChallenge struct {
	ID               string
	LastChallengedAt time.Time
	LastFailedAt     time.Time
	FailureCount     uint16
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
	LastVerifiedAt time.Time
}

func (a *authFactor) GetLastVerifiedAt() time.Time {
	return a.LastVerifiedAt
}

func (a *authFactor) SetLastVerifiedAt(lastVerifiedAt time.Time) {
	a.LastVerifiedAt = lastVerifiedAt
}
