package domain

import "time"

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
