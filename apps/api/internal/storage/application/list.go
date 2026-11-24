package application

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// RevisionsListOptions scopes a read to one application's revisions, newest
// first, at most limit of them. The order is the revision's created_at DESC,
// then its id DESC, both on the revision row.
func RevisionsListOptions(projectID, applicationID string, limit uint32) *database.ListOptions[domain.ApplicationField] {
	return &database.ListOptions[domain.ApplicationField]{
		Filter: database.And(
			database.Equal(database.Col(domain.ApplicationFieldProjectID), projectID),
			database.Equal(database.Col(domain.ApplicationFieldID), applicationID),
		),
		Pagination: database.Page[domain.ApplicationField]{
			Limit: limit,
			OrderBy: database.OrderBy[domain.ApplicationField]{
				Columns: []database.Column[domain.ApplicationField]{
					database.Col(domain.ApplicationFieldUpdatedAt),
					database.Col(domain.ApplicationFieldRevisionID),
				},
				Direction: database.OrderDesc,
			},
		},
	}
}
