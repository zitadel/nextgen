package branding

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

// NewestFirst is created_at DESC, id DESC. id (ULID) breaks created_at ties
// deterministically when revisions share the same timestamp.
func NewestFirst() database.OrderBy[domain.BrandingField] {
	return database.OrderBy[domain.BrandingField]{
		Columns: []database.Column[domain.BrandingField]{
			database.Col(domain.BrandingFieldCreatedAt),
			database.Col(domain.BrandingFieldID),
		},
		Direction: database.OrderDesc,
	}
}

// ListOptions returns options for listing a project's branding revisions,
// newest first, capped at limit.
func ListOptions(projectID string, limit uint32) *database.ListOptions[domain.BrandingField] {
	return &database.ListOptions[domain.BrandingField]{
		Filter: database.Equal(database.Col(domain.BrandingFieldProjectID), projectID),
		Pagination: database.Page[domain.BrandingField]{
			Limit:   limit,
			OrderBy: NewestFirst(),
		},
	}
}
