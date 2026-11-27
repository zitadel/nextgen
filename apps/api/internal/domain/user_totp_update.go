package domain

import "time"

type UserTOTPUpdate interface {
	userTOTPUpdate()
}

type UserTOTPSecretUpdate struct {
	Secret []byte
}

func (*UserTOTPSecretUpdate) userTOTPUpdate() {}

type UserTOTPVerifiedAtUpdate struct {
	VerifiedAt time.Time
}

func (*UserTOTPVerifiedAtUpdate) userTOTPUpdate() {}

type UserTOTPLastSuccessfulCheckUpdate struct {
	LastSuccessfulCheck time.Time
}

func (*UserTOTPLastSuccessfulCheckUpdate) userTOTPUpdate() {}

type UserTOTPIncrementFailedAttemptsUpdate struct {
	Delta uint8
}

func (*UserTOTPIncrementFailedAttemptsUpdate) userTOTPUpdate() {}

type UserTOTPResetFailedAttemptsUpdate struct{}

func (*UserTOTPResetFailedAttemptsUpdate) userTOTPUpdate() {}
