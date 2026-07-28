package domain

import "time"

// UserTOTPUpdate is one typed mid-lifecycle change for user_totp rows.
// Callers must pass pointers (e.g. &UserTOTPVerifiedAtUpdate{...}).
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
	Delta int16
}

func (*UserTOTPIncrementFailedAttemptsUpdate) userTOTPUpdate() {}

type UserTOTPResetFailedAttemptsUpdate struct{}

func (*UserTOTPResetFailedAttemptsUpdate) userTOTPUpdate() {}

// NewUserTOTPSecretUpdate copies secret so callers cannot share a mutable buffer.
func NewUserTOTPSecretUpdate(secret []byte) *UserTOTPSecretUpdate {
	return &UserTOTPSecretUpdate{Secret: append([]byte(nil), secret...)}
}
