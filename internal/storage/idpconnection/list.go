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
