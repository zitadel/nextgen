package database_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func TestSchemaSQLNameAndValuesFrom(t *testing.T) {
	createdAt := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	project := &domain.Project{
		ID:        "proj_1",
		CreatedAt: createdAt,
		UpdatedAt: createdAt,
	}

	schema := database.NewSchema(map[domain.ProjectField]database.FieldBinding[domain.Project]{
		domain.ProjectFieldID: {
			SQLName:  "id",
			Accessor: func(p *domain.Project) any { return p.ID },
		},
		domain.ProjectFieldCreatedAt: {
			SQLName:  "created_at",
			Accessor: func(p *domain.Project) any { return p.CreatedAt },
		},
	})

	assert.Equal(t, "id", schema.SQLName(database.Col(domain.ProjectFieldID)))
	assert.Equal(t, "created_at", schema.MustSQLName(domain.ProjectFieldCreatedAt))

	values := schema.ValuesFrom(project, []database.Column[domain.ProjectField]{
		database.Col(domain.ProjectFieldID),
		database.Col(domain.ProjectFieldCreatedAt),
	})
	require.Len(t, values, 2)
	assert.Equal(t, "proj_1", values[0])
	assert.Equal(t, createdAt, values[1])
}

func TestSchemaUnknownFieldPanics(t *testing.T) {
	schema := database.NewSchema(map[domain.ProjectField]database.FieldBinding[domain.Project]{
		domain.ProjectFieldID: {
			SQLName:  "id",
			Accessor: func(p *domain.Project) any { return p.ID },
		},
	})

	assert.Panics(t, func() {
		schema.SQLName(database.Col(domain.ProjectFieldUnspecified))
	})
}
