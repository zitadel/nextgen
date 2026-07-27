package domain

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/storage/database"
)

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

//go:generate go tool mockgen -typed -package domainmock -destination ./mock/team_membership.mock.go . TeamMembershipRepository

// TeamMembershipRepository persists team roster participation.
type TeamMembershipRepository interface {
	Create(ctx context.Context, client database.QueryExecutor, membership *TeamMembership) error
	Get(ctx context.Context, client database.QueryExecutor, projectID, teamID, userID string) (*TeamMembership, error)
	ListByUser(ctx context.Context, client database.QueryExecutor, projectID, userID string) ([]*TeamMembership, error)
	ListByTeam(ctx context.Context, client database.QueryExecutor, projectID, teamID string) ([]*TeamMembership, error)
	UpdateStatus(ctx context.Context, client database.QueryExecutor, projectID, teamID, userID string, status MembershipStatus) error
}
