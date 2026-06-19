package domain

// import (
// 	"context"

// 	"github.com/zitadel/nextgen/internal/domain"
// 	"github.com/zitadel/nextgen/internal/storage/v2/database"
// )

// type Project = domain.Project

// type ProjectRepository interface {
// 	// Create persists a new project. The repository sets [Project.CreatedAt] and
// 	// [Project.UpdatedAt] to the current time; callers should not pre-populate
// 	// those fields. Callers MUST pre-populate [Project.ProjectSecret],
// 	// [Project.PreviewSecret], and [Project.PreviewOrigins].
// 	// Returns a [database.IntegrityViolationError] (specifically [database.UniqueError])
// 	// if a project with the same ID already exists.
// 	Create(ctx context.Context, client database.QueryExecutor, project *Project) error

// 	// Get retrieves a project by its ID.
// 	// Returns a [database.NoRowFoundError] when no project with the given ID exists.
// 	Get(ctx context.Context, client database.QueryExecutor, id string) (*Project, error)
// }
