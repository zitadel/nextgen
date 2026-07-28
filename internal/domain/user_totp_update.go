package domain

import "time"

type UserTOTPUpdate func(*UserTOTPUpdates)

// UserTOTPUpdates is the accumulated field patch for UpdateUserTOTP.
type UserTOTPUpdates struct {
	Secret              *[]byte
	VerifiedAt          *time.Time
	LastSuccessfulCheck *time.Time
	FailedAttemptsDelta int16
	ResetFailedAttempts bool
}

func NewUserTOTPUpdates(opts ...UserTOTPUpdate) *UserTOTPUpdates {
	u := &UserTOTPUpdates{}
	for _, opt := range opts {
		opt(u)
	}
	return u
}

func (u *UserTOTPUpdates) Empty() bool {
	return u == nil ||
		(u.Secret == nil &&
			u.VerifiedAt == nil &&
			u.LastSuccessfulCheck == nil &&
			u.FailedAttemptsDelta == 0 &&
			!u.ResetFailedAttempts)
}

func WithUserTOTPSecret(secret []byte) UserTOTPUpdate {
	copied := append([]byte(nil), secret...)
	return func(u *UserTOTPUpdates) {
		u.Secret = &copied
	}
}

func WithUserTOTPVerifiedAt(at time.Time) UserTOTPUpdate {
	return func(u *UserTOTPUpdates) {
		u.VerifiedAt = &at
	}
}

func WithUserTOTPLastSuccessfulCheck(at time.Time) UserTOTPUpdate {
	return func(u *UserTOTPUpdates) {
		u.LastSuccessfulCheck = &at
	}
}

func WithUserTOTPIncrementFailedAttempts() UserTOTPUpdate {
	return func(u *UserTOTPUpdates) {
		u.ResetFailedAttempts = false
		u.FailedAttemptsDelta++
	}
}

func WithUserTOTPResetFailedAttempts() UserTOTPUpdate {
	return func(u *UserTOTPUpdates) {
		u.ResetFailedAttempts = true
		u.FailedAttemptsDelta = 0
	}
}
