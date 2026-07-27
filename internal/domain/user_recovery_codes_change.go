package domain

import "time"

// UserRecoveryCodesChange is an opaque mid-lifecycle update for user_recovery_codes rows.
type UserRecoveryCodesChange struct {
	kind  UserRecoveryCodesChangeKind
	codes []string
	at    *time.Time
}

// UserRecoveryCodesChangeKind identifies which column a [UserRecoveryCodesChange] targets.
type UserRecoveryCodesChangeKind uint8

const (
	UserRecoveryCodesChangeUnspecified UserRecoveryCodesChangeKind = iota
	UserRecoveryCodesChangeSetCodes
	UserRecoveryCodesChangeSetLastSuccessfulCheck
	UserRecoveryCodesChangeIncrementFailedAttempts
	UserRecoveryCodesChangeResetFailedAttempts
)

func UserRecoveryCodesSetCodes(codes []string) UserRecoveryCodesChange {
	copied := append([]string(nil), codes...)
	if copied == nil {
		copied = []string{}
	}
	return UserRecoveryCodesChange{kind: UserRecoveryCodesChangeSetCodes, codes: copied}
}

func UserRecoveryCodesSetLastSuccessfulCheck(at *time.Time) UserRecoveryCodesChange {
	var copied *time.Time
	if at != nil {
		t := *at
		copied = &t
	}
	return UserRecoveryCodesChange{kind: UserRecoveryCodesChangeSetLastSuccessfulCheck, at: copied}
}

func UserRecoveryCodesIncrementFailedAttempts() UserRecoveryCodesChange {
	return UserRecoveryCodesChange{kind: UserRecoveryCodesChangeIncrementFailedAttempts}
}

func UserRecoveryCodesResetFailedAttempts() UserRecoveryCodesChange {
	return UserRecoveryCodesChange{kind: UserRecoveryCodesChangeResetFailedAttempts}
}

func (c UserRecoveryCodesChange) Kind() UserRecoveryCodesChangeKind { return c.kind }
func (c UserRecoveryCodesChange) Codes() []string                   { return c.codes }
func (c UserRecoveryCodesChange) TimePtr() *time.Time               { return c.at }
