package user

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/pagination"
)

// EnsureListOptions returns opts with the default CreatedAt+ID ASC order when
// OrderBy is unset. A nil opts becomes an empty ListOptions.
func EnsureListOptions(opts *database.ListOptions[domain.UserField]) *database.ListOptions[domain.UserField] {
	if opts == nil {
		opts = &database.ListOptions[domain.UserField]{}
	}
	out := *opts
	if len(out.Pagination.OrderBy.Columns) == 0 {
		out.Pagination.OrderBy = database.OrderBy[domain.UserField]{
			Columns: []database.Column[domain.UserField]{
				database.Col(domain.UserFieldCreatedAt),
				database.Col(domain.UserFieldID),
			},
			Direction: database.OrderAsc,
		}
	}
	return &out
}

// ApplyCursor adds a keyset cursor predicate to filter when page.Cursor is set.
func ApplyCursor(filter database.Filter[domain.UserField], page database.Page[domain.UserField]) (database.Filter[domain.UserField], error) {
	if len(page.Cursor) == 0 {
		return filter, nil
	}
	cursor, err := pagination.CursorFromToken[domain.UserField](page.Cursor)
	if err != nil {
		return nil, database.ErrInvalidCursor()
	}
	if !cursor.MatchesOrderBy(page.OrderBy) {
		return nil, database.ErrCursorOrderMismatch()
	}
	values, err := Schema.CoerceCursorValues(cursor.Columns, cursor.Values)
	if err != nil {
		return nil, database.ErrInvalidCursor().WithParent(err)
	}
	terms := make([]database.CompareTerm[domain.UserField], len(cursor.Columns))
	for i, column := range cursor.Columns {
		terms[i] = database.Term(column, values[i])
	}
	if page.OrderBy.Direction == database.OrderAsc {
		return database.And(filter, database.CompareGreater(terms...)), nil
	}
	return database.And(filter, database.CompareLess(terms...)), nil
}

// NextCursor returns a marshaled keyset cursor when the page is full; otherwise nil.
func NextCursor(users []*domain.User, page database.Page[domain.UserField]) []byte {
	if page.Limit == 0 || len(users) != int(page.Limit) {
		return nil
	}
	return pagination.New(page.OrderBy, Schema.ValuesFrom(users[len(users)-1], page.OrderBy.Columns)).Marshal()
}

// ProjectGroup is one project's users prepared for attribute hydration.
type ProjectGroup struct {
	ProjectID string
	IDs       []string
	ByID      map[string]*domain.User
}

// GroupByProject clears Attributes and groups users by ProjectID for hydration.
func GroupByProject(users []*domain.User) []ProjectGroup {
	byProject := make(map[string]*ProjectGroup, len(users))
	order := make([]string, 0, len(users))
	for _, u := range users {
		u.Attributes = nil
		g, ok := byProject[u.ProjectID]
		if !ok {
			g = &ProjectGroup{
				ProjectID: u.ProjectID,
				ByID:      make(map[string]*domain.User),
			}
			byProject[u.ProjectID] = g
			order = append(order, u.ProjectID)
		}
		g.IDs = append(g.IDs, u.ID)
		g.ByID[u.ID] = u
	}
	out := make([]ProjectGroup, 0, len(order))
	for _, projectID := range order {
		out = append(out, *byProject[projectID])
	}
	return out
}
