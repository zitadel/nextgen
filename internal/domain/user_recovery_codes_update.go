package domain

import (
	"errors"
	"time"
)

// ErrEmptyRecoveryCodes is returned when create/update would persist an empty recovery_codes set.
// Schema CHECK requires cardinality(recovery_codes) > 0.
var ErrEmptyRecoveryCodes = errors.New("recovery codes must contain at least one code")

// RequireNonEmptyRecoveryCodes rejects nil or empty code slices before SQL.
func RequireNonEmptyRecoveryCodes(codes []string) error {
	if len(codes) == 0 {
		return ErrEmptyRecoveryCodes
	}
	return nil
}

// UserRecoveryCodesUpdate is one typed mid-lifecycle change for user_recovery_codes rows.
// Callers must pass pointers.
type UserRecoveryCodesUpdate interface {
	userRecoveryCodesUpdate()
}

type UserRecoveryCodesCodesUpdate struct {
	Codes []string
}

func (*UserRecoveryCodesCodesUpdate) userRecoveryCodesUpdate() {}

type UserRecoveryCodesLastSuccessfulCheckUpdate struct {
	// LastSuccessfulCheck nil clears the column to SQL NULL.
	LastSuccessfulCheck *time.Time
}

func (*UserRecoveryCodesLastSuccessfulCheckUpdate) userRecoveryCodesUpdate() {}

type UserRecoveryCodesIncrementFailedAttemptsUpdate struct {
	Delta int16
}

func (*UserRecoveryCodesIncrementFailedAttemptsUpdate) userRecoveryCodesUpdate() {}

type UserRecoveryCodesResetFailedAttemptsUpdate struct{}

func (*UserRecoveryCodesResetFailedAttemptsUpdate) userRecoveryCodesUpdate() {}

// NewUserRecoveryCodesCodesUpdate copies codes so callers cannot share a mutable slice.
func NewUserRecoveryCodesCodesUpdate(codes []string) *UserRecoveryCodesCodesUpdate {
	return &UserRecoveryCodesCodesUpdate{Codes: append([]string(nil), codes...)}
}
