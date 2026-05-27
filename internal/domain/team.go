package domain

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/storage/database"
)

const (
	PrefixTeam ResourcePrefix = "team"
)

func ErrTeamNotFound() Error {
	return newError(PrefixTeam.ErrorCodePrefix("not_found"), "team not found", nil, nil)
}

func ErrTeamProjectNotFound() Error {
	return newError(PrefixTeam.ErrorCodePrefix("not_found"), "project not found", nil, nil)
}

// Team represents the object defined [here](https://github.com/zitadel/nextgen/blob/main/docs/design/api/resource-map.md#teams)
// It is hardly ever modified but read a lot therefore it should be stored in global tables.
type Team struct {
	// ProjectID links to [Project].
	ProjectID string
	// ID is the unique identifier for the team within the project.
	ID        string
	CreatedAt time.Time
	UpdatedAt time.Time
}

//go:generate go tool mockgen -typed -package domainmock -destination ./mock/team.mock.go . TeamRepository

// TeamRepository provides storage operations for [Team]s.
type TeamRepository interface {
	// Create persists a new team. The repository sets [Team.CreatedAt] and [Team.UpdatedAt]
	// to the current time; callers should not pre-populate those fields.
	// Returns a [database.IntegrityViolationError] (specifically [database.UniqueError])
	// if a team with the same (project_id, id) already exists.
	Create(ctx context.Context, client database.QueryExecutor, team *Team) error

	// Get retrieves a team by its composite primary key (project_id, id).
	// Returns a [database.NoRowFoundError] when no team with the given keys exists.
	Get(ctx context.Context, client database.QueryExecutor, projectID, id string) (*Team, error)
}
