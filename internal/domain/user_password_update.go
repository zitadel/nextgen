package domain

import "time"

// UserPasswordUpdate configures a mid-lifecycle update for user_passwords rows.
type UserPasswordUpdate func(*UserPasswordUpdates)

// UserPasswordUpdates accumulates [UserPasswordUpdate] options into ordered set operations.
type UserPasswordUpdates struct {
	ops []UserPasswordOp
}

// UserPasswordOpKind identifies one SET operation for user_passwords.
type UserPasswordOpKind uint8

const (
	UserPasswordOpUnspecified UserPasswordOpKind = iota
	UserPasswordOpSetEncodedHash
	UserPasswordOpSetChangeRequired
	UserPasswordOpSetChangedAt
	UserPasswordOpSetVerificationID
	UserPasswordOpSetLastSuccessfulCheck
	UserPasswordOpIncrementFailedAttempts
	UserPasswordOpResetFailedAttempts
)

// UserPasswordOp is one SET clause contribution produced by a [UserPasswordUpdate].
type UserPasswordOp struct {
	Kind UserPasswordOpKind
	Str  string
	Bool bool
	Time time.Time
}

// NewUserPasswordUpdates applies options in order.
func NewUserPasswordUpdates(opts ...UserPasswordUpdate) *UserPasswordUpdates {
	u := &UserPasswordUpdates{}
	for _, opt := range opts {
		if opt != nil {
			opt(u)
		}
	}
	return u
}

func (u *UserPasswordUpdates) Empty() bool           { return u == nil || len(u.ops) == 0 }
func (u *UserPasswordUpdates) Ops() []UserPasswordOp { return u.ops }

func WithUserPasswordEncodedHash(hash string) UserPasswordUpdate {
	return func(u *UserPasswordUpdates) {
		u.ops = append(u.ops, UserPasswordOp{Kind: UserPasswordOpSetEncodedHash, Str: hash})
	}
}

func WithUserPasswordChangeRequired(required bool) UserPasswordUpdate {
	return func(u *UserPasswordUpdates) {
		u.ops = append(u.ops, UserPasswordOp{Kind: UserPasswordOpSetChangeRequired, Bool: required})
	}
}

func WithUserPasswordChangedAt(at time.Time) UserPasswordUpdate {
	return func(u *UserPasswordUpdates) {
		u.ops = append(u.ops, UserPasswordOp{Kind: UserPasswordOpSetChangedAt, Time: at})
	}
}

func WithUserPasswordVerificationID(id string) UserPasswordUpdate {
	return func(u *UserPasswordUpdates) {
		u.ops = append(u.ops, UserPasswordOp{Kind: UserPasswordOpSetVerificationID, Str: id})
	}
}

func WithUserPasswordLastSuccessfulCheck(at time.Time) UserPasswordUpdate {
	return func(u *UserPasswordUpdates) {
		u.ops = append(u.ops, UserPasswordOp{Kind: UserPasswordOpSetLastSuccessfulCheck, Time: at})
	}
}

func WithUserPasswordIncrementFailedAttempts() UserPasswordUpdate {
	return func(u *UserPasswordUpdates) {
		u.ops = append(u.ops, UserPasswordOp{Kind: UserPasswordOpIncrementFailedAttempts})
	}
}

func WithUserPasswordResetFailedAttempts() UserPasswordUpdate {
	return func(u *UserPasswordUpdates) {
		u.ops = append(u.ops, UserPasswordOp{Kind: UserPasswordOpResetFailedAttempts})
	}
}
