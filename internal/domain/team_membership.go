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

// RosterMembershipStatuses are the participation states that keep a user on a
// team's roster. [MembershipStatusRemoved] is deliberately absent: a removed
// membership is history, not roster, and roster reads must not serve it.
var RosterMembershipStatuses = []MembershipStatus{
	MembershipStatusPending,
	MembershipStatusActive,
	MembershipStatusInactive,
}

// TeamMembership is the canonical N:N roster between users and teams.
type TeamMembership struct {
	ProjectID string
	TeamID    string
	UserID    string
	Status    MembershipStatus
	CreatedAt time.Time
	UpdatedAt time.Time
}

// TeamMembershipField enumerates the fields of TeamMembership which can be used for filtering and ordering in list operations.
type TeamMembershipField uint8

const (
	TeamMembershipFieldUnspecified TeamMembershipField = iota
	TeamMembershipFieldProjectID
	TeamMembershipFieldTeamID
	TeamMembershipFieldUserID
	TeamMembershipFieldStatus
	TeamMembershipFieldCreatedAt
	TeamMembershipFieldUpdatedAt
)
