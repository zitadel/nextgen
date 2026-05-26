package domain

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/storage/database"
)

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

type TeamRepository interface {
	Create(ctx context.Context, client database.QueryExecutor, team *Team) error
	GetById(ctx context.Context, client database.QueryExecutor, projectID string, teamID string) (*Team, error)
}
