package policy

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// NewestFirst is created_at DESC, id DESC. id (ULID) breaks created_at ties
// deterministically when revisions share the same timestamp.
func NewestFirst() database.OrderBy[domain.PolicyField] {
	return database.OrderBy[domain.PolicyField]{
		Columns: []database.Column[domain.PolicyField]{
			database.Col(domain.PolicyFieldCreatedAt),
			database.Col(domain.PolicyFieldID),
		},
		Direction: database.OrderDesc,
	}
}

// ListOptions lists a project's policy revisions, newest first, capped at
// limit.
func ListOptions(projectID string, limit uint32) *database.ListOptions[domain.PolicyField] {
	return &database.ListOptions[domain.PolicyField]{
		Filter: database.Equal(database.Col(domain.PolicyFieldProjectID), projectID),
		Pagination: database.Page[domain.PolicyField]{
			Limit:   limit,
			OrderBy: NewestFirst(),
		},
	}
}

// ListOperationOptions lists the revisions of one operation, newest first.
func ListOperationOptions(projectID, operation string, limit uint32) *database.ListOptions[domain.PolicyField] {
	return &database.ListOptions[domain.PolicyField]{
		Filter: database.And(
			database.Equal(database.Col(domain.PolicyFieldProjectID), projectID),
			database.Equal(database.Col(domain.PolicyFieldOperation), operation),
		),
		Pagination: database.Page[domain.PolicyField]{
			Limit:   limit,
			OrderBy: NewestFirst(),
		},
	}
}
