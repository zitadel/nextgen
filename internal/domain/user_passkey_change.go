package domain

import "time"

// UserPasskeyChange is an opaque mid-lifecycle update for user_passkeys rows.
type UserPasskeyChange struct {
	kind            UserPasskeyChangeKind
	attestationType string
	transports      []string
	signCount       int64
	boolVal         bool
	at              time.Time
}

// UserPasskeyChangeKind identifies which column a [UserPasskeyChange] targets.
type UserPasskeyChangeKind uint8

const (
	UserPasskeyChangeUnspecified UserPasskeyChangeKind = iota
	UserPasskeyChangeSetAttestationType
	UserPasskeyChangeSetTransports
	UserPasskeyChangeSetSignCount
	UserPasskeyChangeIncrementSignCount
	UserPasskeyChangeSetBackupEligible
	UserPasskeyChangeSetBackupState
	UserPasskeyChangeSetVerifiedAt
	UserPasskeyChangeSetLastUsedAt
)

func UserPasskeySetAttestationType(attestationType string) UserPasskeyChange {
	return UserPasskeyChange{kind: UserPasskeyChangeSetAttestationType, attestationType: attestationType}
}

func UserPasskeySetTransports(transports []string) UserPasskeyChange {
	if transports == nil {
		transports = []string{}
	} else {
		transports = append([]string(nil), transports...)
	}
	return UserPasskeyChange{kind: UserPasskeyChangeSetTransports, transports: transports}
}

func UserPasskeySetSignCount(signCount int64) UserPasskeyChange {
	return UserPasskeyChange{kind: UserPasskeyChangeSetSignCount, signCount: signCount}
}

func UserPasskeyIncrementSignCount(diff int64) UserPasskeyChange {
	return UserPasskeyChange{kind: UserPasskeyChangeIncrementSignCount, signCount: diff}
}

func UserPasskeySetBackupEligible(eligible bool) UserPasskeyChange {
	return UserPasskeyChange{kind: UserPasskeyChangeSetBackupEligible, boolVal: eligible}
}

func UserPasskeySetBackupState(state bool) UserPasskeyChange {
	return UserPasskeyChange{kind: UserPasskeyChangeSetBackupState, boolVal: state}
}

func UserPasskeySetVerifiedAt(at time.Time) UserPasskeyChange {
	return UserPasskeyChange{kind: UserPasskeyChangeSetVerifiedAt, at: at}
}

func UserPasskeySetLastUsedAt(at time.Time) UserPasskeyChange {
	return UserPasskeyChange{kind: UserPasskeyChangeSetLastUsedAt, at: at}
}

func (c UserPasskeyChange) Kind() UserPasskeyChangeKind { return c.kind }
func (c UserPasskeyChange) AttestationType() string     { return c.attestationType }
func (c UserPasskeyChange) Transports() []string        { return c.transports }
func (c UserPasskeyChange) SignCount() int64            { return c.signCount }
func (c UserPasskeyChange) Bool() bool                  { return c.boolVal }
func (c UserPasskeyChange) Time() time.Time             { return c.at }
