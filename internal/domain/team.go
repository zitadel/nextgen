package domain

import (
	"strings"
	"time"
	"unicode/utf8"
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

// TeamNameMaxLength bounds the name in characters.
const TeamNameMaxLength = 200

func ErrTeamNameInvalid() Error {
	return newError(PrefixTeam.ErrorCodePrefix("name_invalid"), "The team name is invalid. Expected a non-empty string of at most 200 characters.", nil, nil)
}

func ErrTeamAlreadyExists() Error {
	return newError(PrefixTeam.ErrorCodePrefix("already_exists"), "a team with this name already exists in the project", nil, nil)
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
	name, err := ValidateTeamName(name)
	if err != nil {
		return nil, err
	}

	return &Team{
		ProjectID: projectID,
		Name:      name,
	}, nil
}

// ValidateTeamName returns the trimmed name, or ErrTeamNameInvalid when it is
// empty or longer than TeamNameMaxLength.
func ValidateTeamName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > TeamNameMaxLength {
		return "", ErrTeamNameInvalid()
	}
	return name, nil
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
