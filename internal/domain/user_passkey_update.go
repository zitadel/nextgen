package domain

import "time"

// UserPasskeyUpdate configures a mid-lifecycle update for user_passkeys rows.
type UserPasskeyUpdate func(*UserPasskeyUpdates)

// UserPasskeyUpdates accumulates [UserPasskeyUpdate] options into ordered set operations.
type UserPasskeyUpdates struct {
	ops []UserPasskeyOp
}

// UserPasskeyOpKind identifies one SET operation for user_passkeys.
type UserPasskeyOpKind uint8

const (
	UserPasskeyOpUnspecified UserPasskeyOpKind = iota
	UserPasskeyOpSetAttestationType
	UserPasskeyOpSetTransports
	UserPasskeyOpSetSignCount
	UserPasskeyOpIncrementSignCount
	UserPasskeyOpSetBackupEligible
	UserPasskeyOpSetBackupState
	UserPasskeyOpSetVerifiedAt
	UserPasskeyOpSetLastUsedAt
)

// UserPasskeyOp is one SET clause contribution produced by a [UserPasskeyUpdate].
type UserPasskeyOp struct {
	Kind            UserPasskeyOpKind
	AttestationType string
	Transports      []string
	SignCount       int64
	Bool            bool
	Time            time.Time
}

// NewUserPasskeyUpdates applies options in order.
func NewUserPasskeyUpdates(opts ...UserPasskeyUpdate) *UserPasskeyUpdates {
	u := &UserPasskeyUpdates{}
	for _, opt := range opts {
		if opt != nil {
			opt(u)
		}
	}
	return u
}

func (u *UserPasskeyUpdates) Empty() bool           { return u == nil || len(u.ops) == 0 }
func (u *UserPasskeyUpdates) Ops() []UserPasskeyOp { return u.ops }

func WithUserPasskeyAttestationType(attestationType string) UserPasskeyUpdate {
	return func(u *UserPasskeyUpdates) {
		u.ops = append(u.ops, UserPasskeyOp{Kind: UserPasskeyOpSetAttestationType, AttestationType: attestationType})
	}
}

func WithUserPasskeyTransports(transports []string) UserPasskeyUpdate {
	if transports == nil {
		transports = []string{}
	} else {
		transports = append([]string(nil), transports...)
	}
	return func(u *UserPasskeyUpdates) {
		u.ops = append(u.ops, UserPasskeyOp{Kind: UserPasskeyOpSetTransports, Transports: transports})
	}
}

func WithUserPasskeySignCount(signCount int64) UserPasskeyUpdate {
	return func(u *UserPasskeyUpdates) {
		u.ops = append(u.ops, UserPasskeyOp{Kind: UserPasskeyOpSetSignCount, SignCount: signCount})
	}
}

func WithUserPasskeyIncrementSignCount(diff int64) UserPasskeyUpdate {
	return func(u *UserPasskeyUpdates) {
		u.ops = append(u.ops, UserPasskeyOp{Kind: UserPasskeyOpIncrementSignCount, SignCount: diff})
	}
}

func WithUserPasskeyBackupEligible(eligible bool) UserPasskeyUpdate {
	return func(u *UserPasskeyUpdates) {
		u.ops = append(u.ops, UserPasskeyOp{Kind: UserPasskeyOpSetBackupEligible, Bool: eligible})
	}
}

func WithUserPasskeyBackupState(state bool) UserPasskeyUpdate {
	return func(u *UserPasskeyUpdates) {
		u.ops = append(u.ops, UserPasskeyOp{Kind: UserPasskeyOpSetBackupState, Bool: state})
	}
}

func WithUserPasskeyVerifiedAt(at time.Time) UserPasskeyUpdate {
	return func(u *UserPasskeyUpdates) {
		u.ops = append(u.ops, UserPasskeyOp{Kind: UserPasskeyOpSetVerifiedAt, Time: at})
	}
}

func WithUserPasskeyLastUsedAt(at time.Time) UserPasskeyUpdate {
	return func(u *UserPasskeyUpdates) {
		u.ops = append(u.ops, UserPasskeyOp{Kind: UserPasskeyOpSetLastUsedAt, Time: at})
	}
}
