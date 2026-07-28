package domain

import (
	"strings"
	"time"
)

const (
	PrefixTeam ResourcePrefix = "team"
)

// TeamStatus is the lifecycle state of a team within a project.
type TeamStatus string

const (
	TeamStatusActive       TeamStatus = "active"
	TeamStatusDeactivated  TeamStatus = "deactivated"
	TeamStatusPendingPurge TeamStatus = "pending_purge"
)

func (s TeamStatus) String() string { return string(s) }

func ErrTeamNameInvalid() Error {
	return newError(PrefixTeam.ErrorCodePrefix("name_invalid"), "The team name is invalid. Expected a non-empty string.", nil, nil)
}

func ErrTeamNotFound() Error {
	return newError(PrefixTeam.ErrorCodePrefix("team_not_found"), "team not found", nil, nil)
}

func ErrTeamProjectNotFound() Error {
	return newError(PrefixTeam.ErrorCodePrefix("project_not_found"), "project not found", nil, nil)
}

func ErrTeamPermissionDenied() Error {
	return newError(PrefixTeam.ErrorCodePrefix("permission_denied"), "the team management API requires the project secret", nil, nil)
}

// Team represents the object defined [here](https://github.com/zitadel/nextgen/blob/main/docs/design/api/resource-map.md#teams)
// It is hardly ever modified but read a lot therefore it should be stored in global tables.
type Team struct {
	// ProjectID links to [Project].
	ProjectID string
	// ID is the unique identifier for the team within the project.
	ID        string
	Name      string
	Status    TeamStatus
	CreatedAt time.Time
	UpdatedAt time.Time
}

func NewTeam(projectID, name string) (*Team, error) {
	id, err := newID(PrefixTeam)
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to create team id")
	}

	name = strings.TrimSpace(name)
	if name == "" {
		return nil, ErrTeamNameInvalid()
	}

	return &Team{
		ProjectID: projectID,
		ID:        id,
		Name:      name,
	}, nil
}

// TeamField enumerates the fields of Team which can be used for filtering and ordering.
type TeamField uint8

const (
	TeamFieldUnspecified TeamField = iota
	TeamFieldProjectID
	TeamFieldID
	TeamFieldName
	TeamFieldStatus
	TeamFieldCreatedAt
	TeamFieldUpdatedAt
)
