package domain

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/storage/database"
)

// Project is a minimal representation of the object defined [here](https://github.com/zitadel/nextgen/blob/main/docs/design/api/resource-map.md#projects)
// It is hardly ever modified but read a lot therefore it should be stored in global tables.
type Project struct {
	ID        string
	CreatedAt time.Time
	UpdatedAt time.Time
}

//go:generate go tool mockgen -typed -package domainmock -destination ./mock/project.mock.go . ProjectRepository

// ProjectRepository provides storage operations for [Project]s.
type ProjectRepository interface {
	// Create persists a new project. The repository sets [Project.CreatedAt] and
	// [Project.UpdatedAt] to the current time; callers should not pre-populate
	// those fields.
	// Returns an [database.IntegrityViolationError] (specifically [database.UniqueError])
	// if a project with the same ID already exists.
	Create(ctx context.Context, client database.QueryExecutor, project *Project) error

	// Get retrieves a project by its ID.
	// Returns a [database.NoRowFoundError] when no project with the given ID exists.
	Get(ctx context.Context, client database.QueryExecutor, id string) (*Project, error)
}
