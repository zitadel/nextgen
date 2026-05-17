package domain

import "time"

type AuthCheck struct {
	// ID is the storage identifier for the underlying check row when persisted.
	ID   string
	Type AuthCheckType

	// Persistence scope for the checks table (ADR 010).
	ProjectID     string
	AuthAttemptID *string
	SessionID     *string

	UserPassword      *UserPassword
	UserTOTP          *UserTOTP
	UserPasskey       *UserPasskey
	UserRecoveryCodes *UserRecoveryCodes

	// When the check was verified successfully, it must be set by the storage and is read only.
	LastVerifiedAt time.Time
	// When the check was last challenged. It must be set by the storage and is read only.
	LastChallengedAt time.Time
	// When the check last failed. It must be set by the storage and is read only.
	// The repository MUST provide a method to set it to the current time, and to reset it to nil after a successful verification.
	LastFailedAt *time.Time
	// When the check was handed off to a session.
	HandedOffAt *time.Time
	// Times the check failed.
	// The value is read only. Use increment and reset functions of the repository to modify it.
	FailureCount uint16
	// Optional pointer to a superseded check row.
	Supersedes *string
}

// Succeeded reports whether the check completed successfully.
func (a *AuthCheck) Succeeded() bool {
	return a != nil && !a.LastVerifiedAt.IsZero()
}

// CredentialKey returns a stable merge/dedup key for credential-bound checks.
func (a *AuthCheck) CredentialKey() (kind string, id int64, ok bool) {
	if a == nil {
		return "", 0, false
	}
	switch {
	case a.UserPassword != nil:
		return "password", a.UserPassword.ID, true
	case a.UserTOTP != nil:
		return "totp", a.UserTOTP.ID, true
	case a.UserPasskey != nil:
		return "passkey", a.UserPasskey.ID, true
	case a.UserRecoveryCodes != nil:
		return "recovery", a.UserRecoveryCodes.ID, true
	default:
		return "", 0, false
	}
}

// PersistCredentialFK returns the checks-table column and id for the bound credential, if any.
func (a *AuthCheck) PersistCredentialFK() (column string, id int64, ok bool) {
	if a == nil {
		return "", 0, false
	}
	switch {
	case a.UserPassword != nil:
		return "user_password_id", a.UserPassword.ID, true
	case a.UserTOTP != nil:
		return "user_totp_id", a.UserTOTP.ID, true
	case a.UserPasskey != nil:
		return "user_passkey_id", a.UserPasskey.ID, true
	case a.UserRecoveryCodes != nil:
		return "user_recovery_codes_id", a.UserRecoveryCodes.ID, true
	default:
		return "", 0, false
	}
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
