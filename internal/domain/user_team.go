package domain

import "time"

// UserTeam is one entry of a user's team roster: the membership joined to the
// team it points at, so a reader gets the team's name without a second lookup.
//
// The roster is not lifecycle ownership. A user can sit on many team rosters
// while still owning their own lifecycle — see [User.LifecycleOwnerTeamID] and
// ADR 024.
type UserTeam struct {
	ProjectID string
	UserID    string
	TeamID    string
	TeamName  string
	// Status is the roster participation state, not the team's own status.
	Status    MembershipStatus
	CreatedAt time.Time
	UpdatedAt time.Time
}

// UserTeamField enumerates the fields of UserTeam which can be used for
// filtering and ordering in list operations.
type UserTeamField uint8

const (
	UserTeamFieldUnspecified UserTeamField = iota
	UserTeamFieldProjectID
	UserTeamFieldUserID
	UserTeamFieldTeamID
	UserTeamFieldTeamName
	UserTeamFieldStatus
	UserTeamFieldCreatedAt
	UserTeamFieldUpdatedAt
)
