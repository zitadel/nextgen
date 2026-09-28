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
