package environment

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// PipelineOrder is created_at ASC, id ASC.
//
// Oldest first, unlike the revisioned resources: environments are a small
// stable set seeded in promotion order (dev, staging, prod), and reading them
// back in that order is what a deploy target prompt wants. id (a ULID under
// postgres/sqlite, a UUID under spanner) breaks created_at ties so the order
// is total and keyset pages cannot skip or repeat a row.
func PipelineOrder() database.OrderBy[domain.EnvironmentField] {
	return database.OrderBy[domain.EnvironmentField]{
		Columns: []database.Column[domain.EnvironmentField]{
			database.Col(domain.EnvironmentFieldCreatedAt),
			database.Col(domain.EnvironmentFieldID),
		},
		Direction: database.OrderAsc,
	}
}

// ListOptions returns options for listing a project's environments in
// pipeline order, capped at limit and resumed from cursor.
func ListOptions(projectID string, limit uint32, cursor []byte) *database.ListOptions[domain.EnvironmentField] {
	return &database.ListOptions[domain.EnvironmentField]{
		Filter: database.Equal(database.Col(domain.EnvironmentFieldProjectID), projectID),
		Pagination: database.Page[domain.EnvironmentField]{
			Limit:   limit,
			Cursor:  cursor,
			OrderBy: PipelineOrder(),
		},
	}
}
