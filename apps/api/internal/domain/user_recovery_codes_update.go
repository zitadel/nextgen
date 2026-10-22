package domain

import (
	"errors"
	"time"
)

var ErrEmptyRecoveryCodes = errors.New("recovery codes must contain at least one code")

func RequireNonEmptyRecoveryCodes(codes []string) error {
	if len(codes) == 0 {
		return ErrEmptyRecoveryCodes
	}
	return nil
}

type UserRecoveryCodesUpdate interface {
	userRecoveryCodesUpdate()
}

type UserRecoveryCodesCodesUpdate struct {
	Codes []string
}

func (*UserRecoveryCodesCodesUpdate) userRecoveryCodesUpdate() {}

type UserRecoveryCodesLastSuccessfulCheckUpdate struct {
	LastSuccessfulCheck *time.Time
}

func (*UserRecoveryCodesLastSuccessfulCheckUpdate) userRecoveryCodesUpdate() {}

type UserRecoveryCodesIncrementFailedAttemptsUpdate struct {
	Delta uint8
}

func (*UserRecoveryCodesIncrementFailedAttemptsUpdate) userRecoveryCodesUpdate() {}

type UserRecoveryCodesResetFailedAttemptsUpdate struct{}

func (*UserRecoveryCodesResetFailedAttemptsUpdate) userRecoveryCodesUpdate() {}
