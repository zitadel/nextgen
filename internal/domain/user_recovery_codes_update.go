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

// UserRecoveryCodesUpdate configures a mid-lifecycle update for user_recovery_codes rows.
type UserRecoveryCodesUpdate func(*UserRecoveryCodesUpdates)

// UserRecoveryCodesUpdates accumulates [UserRecoveryCodesUpdate] options into ordered set operations.
type UserRecoveryCodesUpdates struct {
	ops []UserRecoveryCodesOp
}

// UserRecoveryCodesOpKind identifies one SET operation for user_recovery_codes.
type UserRecoveryCodesOpKind uint8

const (
	UserRecoveryCodesOpUnspecified UserRecoveryCodesOpKind = iota
	UserRecoveryCodesOpSetCodes
	UserRecoveryCodesOpSetLastSuccessfulCheck
	UserRecoveryCodesOpIncrementFailedAttempts
	UserRecoveryCodesOpResetFailedAttempts
)

// UserRecoveryCodesOp is one SET clause contribution produced by a [UserRecoveryCodesUpdate].
type UserRecoveryCodesOp struct {
	Kind  UserRecoveryCodesOpKind
	Codes []string
	// Time is used for [UserRecoveryCodesOpSetLastSuccessfulCheck]; nil means SQL NULL.
	Time *time.Time
}

// NewUserRecoveryCodesUpdates applies options in order.
func NewUserRecoveryCodesUpdates(opts ...UserRecoveryCodesUpdate) *UserRecoveryCodesUpdates {
	u := &UserRecoveryCodesUpdates{}
	for _, opt := range opts {
		if opt != nil {
			opt(u)
		}
	}
	return u
}

func (u *UserRecoveryCodesUpdates) Empty() bool { return u == nil || len(u.ops) == 0 }
func (u *UserRecoveryCodesUpdates) Ops() []UserRecoveryCodesOp {
	return u.ops
}

func WithUserRecoveryCodesCodes(codes []string) UserRecoveryCodesUpdate {
	copied := append([]string(nil), codes...)
	return func(u *UserRecoveryCodesUpdates) {
		u.ops = append(u.ops, UserRecoveryCodesOp{Kind: UserRecoveryCodesOpSetCodes, Codes: copied})
	}
}

// WithUserRecoveryCodesLastSuccessfulCheck sets last_successful_check; nil clears to NULL.
func WithUserRecoveryCodesLastSuccessfulCheck(at *time.Time) UserRecoveryCodesUpdate {
	var copied *time.Time
	if at != nil {
		t := *at
		copied = &t
	}
	return func(u *UserRecoveryCodesUpdates) {
		u.ops = append(u.ops, UserRecoveryCodesOp{Kind: UserRecoveryCodesOpSetLastSuccessfulCheck, Time: copied})
	}
}

func WithUserRecoveryCodesIncrementFailedAttempts() UserRecoveryCodesUpdate {
	return func(u *UserRecoveryCodesUpdates) {
		u.ops = append(u.ops, UserRecoveryCodesOp{Kind: UserRecoveryCodesOpIncrementFailedAttempts})
	}
}

func WithUserRecoveryCodesResetFailedAttempts() UserRecoveryCodesUpdate {
	return func(u *UserRecoveryCodesUpdates) {
		u.ops = append(u.ops, UserRecoveryCodesOp{Kind: UserRecoveryCodesOpResetFailedAttempts})
	}
}
