package idpconnection

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// EnsureListOptions returns opts with the default created_at + id ascending
// order when OrderBy is unset. A nil opts becomes an empty ListOptions.
//
// Connections sort oldest first, unlike flow definitions and releases: a login
// screen shows them in the order they were added.
func EnsureListOptions(opts *database.ListOptions[domain.IDPConnectionField]) *database.ListOptions[domain.IDPConnectionField] {
	if opts == nil {
		opts = &database.ListOptions[domain.IDPConnectionField]{}
	}
	out := *opts
	if len(out.Pagination.OrderBy.Columns) == 0 {
		out.Pagination.OrderBy = database.OrderBy[domain.IDPConnectionField]{
			Columns: []database.Column[domain.IDPConnectionField]{
				database.Col(domain.IDPConnectionFieldCreatedAt),
				database.Col(domain.IDPConnectionFieldID),
			},
			Direction: database.OrderAsc,
		}
	}
	return &out
}

// RevisionsNewestFirst orders by the revision's created_at DESC, then its id
// DESC. Both columns sit on the revision row, and the id keeps the keyset
// cursor unique.
func RevisionsNewestFirst() database.OrderBy[domain.IDPConnectionField] {
	return database.OrderBy[domain.IDPConnectionField]{
		Columns: []database.Column[domain.IDPConnectionField]{
			database.Col(domain.IDPConnectionFieldUpdatedAt),
			database.Col(domain.IDPConnectionFieldRevisionID),
		},
		Direction: database.OrderDesc,
	}
}

// RevisionsListOptions scopes a list to one connection's revisions, newest
// first. The endpoint offers no filter or sort, so page carries only the limit
// and the cursor.
func RevisionsListOptions(projectID, connectionID string, page database.Page[domain.IDPConnectionField]) *database.ListOptions[domain.IDPConnectionField] {
	if len(page.OrderBy.Columns) == 0 {
		page.OrderBy = RevisionsNewestFirst()
	}
	return &database.ListOptions[domain.IDPConnectionField]{
		Filter: database.And(
			database.Equal(database.Col(domain.IDPConnectionFieldProjectID), projectID),
			database.Equal(database.Col(domain.IDPConnectionFieldID), connectionID),
		),
		Pagination: page,
	}
}
