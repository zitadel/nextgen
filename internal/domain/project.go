package domain

import (
	"context"

	"github.com/zitadel/nextgen/internal/storage/database"
)

// Project represents a the object defined [here](https://github.com/zitadel/nextgen/blob/15bd7f438d709fcd5205a163e24374f6f667b68f/docs/design/api/resource-map.md#projects)
// It is hardly ever modified but read a lot therefore it should be stored in global tables.
type Project struct {
	ID string
}

type ProjectConfig struct {
	DefaultRequiredChecks []AuthCheckType
}

type ProjectRepository interface {
	GetConfig(ctx context.Context, pool database.QueryExecutor, projectID string) (*ProjectConfig, error)
}
