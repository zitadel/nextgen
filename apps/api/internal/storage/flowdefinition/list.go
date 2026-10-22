package flowdefinition

import (
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// EnsureListOptions returns opts with the default CreatedAt+ID DESC order when
// OrderBy is unset. A nil opts becomes an empty ListOptions.
func EnsureListOptions(opts *database.ListOptions[domain.FlowDefinitionField]) *database.ListOptions[domain.FlowDefinitionField] {
	if opts == nil {
		opts = &database.ListOptions[domain.FlowDefinitionField]{}
	}
	out := *opts
	if len(out.Pagination.OrderBy.Columns) == 0 {
		out.Pagination.OrderBy = database.OrderBy[domain.FlowDefinitionField]{
			Columns: []database.Column[domain.FlowDefinitionField]{
				database.Col(domain.FlowDefinitionFieldCreatedAt),
				database.Col(domain.FlowDefinitionFieldID),
			},
			Direction: database.OrderDesc,
		}
	}
	return &out
}

// ByIDs matches the named flow-definition revisions of one project. An OR of
// equals rather than an IN clause, because IN is not in the shared filter
// vocabulary and the id sets here are small — the pinned revisions of one
// release.
func ByIDs(projectID string, ids []string) database.Filter[domain.FlowDefinitionField] {
	matches := make([]database.Filter[domain.FlowDefinitionField], len(ids))
	for i, id := range ids {
		matches[i] = database.Equal(database.Col(domain.FlowDefinitionFieldID), id)
	}
	return database.And(
		database.Equal(database.Col(domain.FlowDefinitionFieldProjectID), projectID),
		database.Or(matches...),
	)
}
