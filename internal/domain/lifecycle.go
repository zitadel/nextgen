package domain

// UserStatus is the lifecycle state of a user identity within a project.
type UserStatus string

const (
	UserStatusActive       UserStatus = "active"
	UserStatusSuspended    UserStatus = "suspended"
	UserStatusDeactivated  UserStatus = "deactivated"
	UserStatusPendingPurge UserStatus = "pending_purge"
)

func (s UserStatus) String() string { return string(s) }

// TeamStatus is the lifecycle state of a team within a project.
type TeamStatus string

const (
	TeamStatusActive       TeamStatus = "active"
	TeamStatusDeactivated  TeamStatus = "deactivated"
	TeamStatusPendingPurge TeamStatus = "pending_purge"
)

func (s TeamStatus) String() string { return string(s) }

// MembershipStatus is the roster participation state for a user on a team.
type MembershipStatus string

const (
	MembershipStatusPending  MembershipStatus = "pending"
	MembershipStatusActive   MembershipStatus = "active"
	MembershipStatusInactive MembershipStatus = "inactive"
	MembershipStatusRemoved  MembershipStatus = "removed"
)

func (s MembershipStatus) String() string { return string(s) }
