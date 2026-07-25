package domain

import "time"

// MembershipStatus is the roster participation state for a user on a team.
type MembershipStatus string

const (
	MembershipStatusPending  MembershipStatus = "pending"
	MembershipStatusActive   MembershipStatus = "active"
	MembershipStatusInactive MembershipStatus = "inactive"
	MembershipStatusRemoved  MembershipStatus = "removed"
)

func (s MembershipStatus) String() string { return string(s) }

// TeamMembership is the canonical N:N roster between users and teams.
type TeamMembership struct {
	ProjectID string
	TeamID    string
	UserID    string
	Status    MembershipStatus
	CreatedAt time.Time
	UpdatedAt time.Time
}
