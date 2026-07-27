package domain

import "time"

// UserPasswordChange is an opaque mid-lifecycle update for user_passwords rows.
type UserPasswordChange struct {
	kind   UserPasswordChangeKind
	str    string
	boolV  bool
	at     time.Time
}

// UserPasswordChangeKind identifies which column a [UserPasswordChange] targets.
type UserPasswordChangeKind uint8

const (
	UserPasswordChangeUnspecified UserPasswordChangeKind = iota
	UserPasswordChangeSetEncodedHash
	UserPasswordChangeSetChangeRequired
	UserPasswordChangeSetChangedAt
	UserPasswordChangeSetVerificationID
	UserPasswordChangeSetLastSuccessfulCheck
	UserPasswordChangeIncrementFailedAttempts
	UserPasswordChangeResetFailedAttempts
)

func UserPasswordSetEncodedHash(hash string) UserPasswordChange {
	return UserPasswordChange{kind: UserPasswordChangeSetEncodedHash, str: hash}
}

func UserPasswordSetChangeRequired(required bool) UserPasswordChange {
	return UserPasswordChange{kind: UserPasswordChangeSetChangeRequired, boolV: required}
}

func UserPasswordSetChangedAt(at time.Time) UserPasswordChange {
	return UserPasswordChange{kind: UserPasswordChangeSetChangedAt, at: at}
}

func UserPasswordSetVerificationID(id string) UserPasswordChange {
	return UserPasswordChange{kind: UserPasswordChangeSetVerificationID, str: id}
}

func UserPasswordSetLastSuccessfulCheck(at time.Time) UserPasswordChange {
	return UserPasswordChange{kind: UserPasswordChangeSetLastSuccessfulCheck, at: at}
}

func UserPasswordIncrementFailedAttempts() UserPasswordChange {
	return UserPasswordChange{kind: UserPasswordChangeIncrementFailedAttempts}
}

func UserPasswordResetFailedAttempts() UserPasswordChange {
	return UserPasswordChange{kind: UserPasswordChangeResetFailedAttempts}
}

func (c UserPasswordChange) Kind() UserPasswordChangeKind { return c.kind }
func (c UserPasswordChange) Text() string                 { return c.str }
func (c UserPasswordChange) Bool() bool                   { return c.boolV }
func (c UserPasswordChange) Time() time.Time              { return c.at }
