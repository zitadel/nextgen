package flowdefinition

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func TestEnsureListOptions_defaultsOrder(t *testing.T) {
	t.Parallel()

	got := EnsureListOptions(nil)
	require.NotNil(t, got)
	assert.Equal(t, []database.Column[domain.FlowDefinitionField]{
		database.Col(domain.FlowDefinitionFieldCreatedAt),
		database.Col(domain.FlowDefinitionFieldID),
	}, got.Pagination.OrderBy.Columns)
	assert.Equal(t, database.OrderDesc, got.Pagination.OrderBy.Direction)
}

func TestEnsureListOptions_preservesExplicitOrder(t *testing.T) {
	t.Parallel()

	in := &database.ListOptions[domain.FlowDefinitionField]{
		Pagination: database.Page[domain.FlowDefinitionField]{
			OrderBy: database.OrderBy[domain.FlowDefinitionField]{
				Columns: []database.Column[domain.FlowDefinitionField]{
					database.Col(domain.FlowDefinitionFieldName),
				},
				Direction: database.OrderAsc,
			},
		},
	}
	got := EnsureListOptions(in)
	require.NotNil(t, got)
	assert.Equal(t, in.Pagination.OrderBy, got.Pagination.OrderBy)
	assert.NotSame(t, in, got)
}
