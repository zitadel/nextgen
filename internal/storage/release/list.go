package release

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// NewestFirst is created_at DESC, id DESC. id breaks created_at ties
// deterministically when two releases share a timestamp.
func NewestFirst() database.OrderBy[domain.ReleaseField] {
	return database.OrderBy[domain.ReleaseField]{
		Columns: []database.Column[domain.ReleaseField]{
			database.Col(domain.ReleaseFieldCreatedAt),
			database.Col(domain.ReleaseFieldID),
		},
		Direction: database.OrderDesc,
	}
}

// ListOptions returns options for listing a project's releases, newest first,
// capped at limit.
func ListOptions(projectID string, limit uint32) *database.ListOptions[domain.ReleaseField] {
	return &database.ListOptions[domain.ReleaseField]{
		Filter: database.Equal(database.Col(domain.ReleaseFieldProjectID), projectID),
		Pagination: database.Page[domain.ReleaseField]{
			Limit:   limit,
			OrderBy: NewestFirst(),
		},
	}
}
