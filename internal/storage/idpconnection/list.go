package idpconnection

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// EnsureListOptions returns opts with the default CreatedAt+ID ASC order when
// OrderBy is unset. A nil opts becomes an empty ListOptions.
//
// Ascending is the contract's default for connections, where flow definitions
// and releases default to descending: a project holds a handful of connections
// that a login screen renders in the order they were added, not a feed whose
// newest entry matters most.
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

// RevisionsNewestFirst is the revision-list order: the revision's own
// created_at DESC, its id DESC. Both columns sit on the revision row, and the
// id breaks the tie between two revises that landed on the same instant.
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
// first. The endpoint exposes neither filter nor sort, so page carries only the
// limit and the cursor; the filter names the connection through the schema
// rather than the revision's connection_id, which the join equates with it.
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
