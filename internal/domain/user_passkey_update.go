package domain

import "time"

// UserPasskeyUpdate is one typed mid-lifecycle change for user_passkeys rows.
// Callers must pass pointers.
type UserPasskeyUpdate interface {
	userPasskeyUpdate()
}

type UserPasskeyAttestationTypeUpdate struct {
	AttestationType string
}

func (*UserPasskeyAttestationTypeUpdate) userPasskeyUpdate() {}

type UserPasskeyTransportsUpdate struct {
	Transports []string
}

func (*UserPasskeyTransportsUpdate) userPasskeyUpdate() {}

type UserPasskeySignCountUpdate struct {
	SignCount int64
}

func (*UserPasskeySignCountUpdate) userPasskeyUpdate() {}

type UserPasskeyIncrementSignCountUpdate struct {
	Delta int64
}

func (*UserPasskeyIncrementSignCountUpdate) userPasskeyUpdate() {}

type UserPasskeyBackupEligibleUpdate struct {
	BackupEligible bool
}

func (*UserPasskeyBackupEligibleUpdate) userPasskeyUpdate() {}

type UserPasskeyBackupStateUpdate struct {
	BackupState bool
}

func (*UserPasskeyBackupStateUpdate) userPasskeyUpdate() {}

type UserPasskeyVerifiedAtUpdate struct {
	VerifiedAt time.Time
}

func (*UserPasskeyVerifiedAtUpdate) userPasskeyUpdate() {}

type UserPasskeyLastUsedAtUpdate struct {
	LastUsedAt time.Time
}

func (*UserPasskeyLastUsedAtUpdate) userPasskeyUpdate() {}

// NewUserPasskeyTransportsUpdate copies transports; nil becomes an empty slice.
func NewUserPasskeyTransportsUpdate(transports []string) *UserPasskeyTransportsUpdate {
	if transports == nil {
		return &UserPasskeyTransportsUpdate{Transports: []string{}}
	}
	return &UserPasskeyTransportsUpdate{Transports: append([]string(nil), transports...)}
}
