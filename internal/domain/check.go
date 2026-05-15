package domain

import "time"

// Check is one verifier interaction persisted per ADR 010.
type Check struct {
	ProjectID string
	ID        string

	AuthAttemptID *string
	SessionID     *string

	Type AuthCheckType

	UserPasswordID       *int64
	UserTOTPID           *int64
	UserPasskeyID        *int64
	UserRecoveryCodesID  *int64

	StartedAt    time.Time
	SucceededAt  time.Time
	FailedAt     *time.Time
	HandedOffAt  *time.Time
	FailureCount uint16

	Challenge any
	Factor    any
	Supersedes *string
}

func (c *Check) Succeeded() bool {
	return !c.SucceededAt.IsZero()
}

// CredentialKey returns a stable merge/dedup key for credential-bound checks.
func (c *Check) CredentialKey() (kind string, id int64, ok bool) {
	switch {
	case c.UserPasswordID != nil:
		return "password", *c.UserPasswordID, true
	case c.UserTOTPID != nil:
		return "totp", *c.UserTOTPID, true
	case c.UserPasskeyID != nil:
		return "passkey", *c.UserPasskeyID, true
	case c.UserRecoveryCodesID != nil:
		return "recovery", *c.UserRecoveryCodesID, true
	default:
		return "", 0, false
	}
}
