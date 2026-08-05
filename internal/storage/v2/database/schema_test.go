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
	t.Parallel()
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
			Coerce:   database.CoerceString,
		},
		domain.ProjectFieldCreatedAt: {
			SQLName:  "created_at",
			Accessor: func(p *domain.Project) any { return p.CreatedAt },
			Coerce:   database.CoerceTime,
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

func TestSchemaCoerceCursorValues(t *testing.T) {
	t.Parallel()
	createdAt := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	schema := database.NewSchema(map[domain.ProjectField]database.FieldBinding[domain.Project]{
		domain.ProjectFieldCreatedAt: {
			SQLName:  "created_at",
			Accessor: func(p *domain.Project) any { return p.CreatedAt },
			Coerce:   database.CoerceTime,
		},
		domain.ProjectFieldID: {
			SQLName:  "id",
			Accessor: func(p *domain.Project) any { return p.ID },
			Coerce:   database.CoerceString,
		},
	})

	values, err := schema.CoerceCursorValues(
		[]database.Column[domain.ProjectField]{
			database.Col(domain.ProjectFieldCreatedAt),
			database.Col(domain.ProjectFieldID),
		},
		[]any{"2026-01-02T03:04:05Z", "proj_1"},
	)
	require.NoError(t, err)
	require.Len(t, values, 2)
	assert.Equal(t, createdAt, values[0])
	assert.Equal(t, "proj_1", values[1])
}

func TestSchemaCoerceCursorValues_nilTime(t *testing.T) {
	t.Parallel()
	schema := database.NewSchema(map[domain.ProjectField]database.FieldBinding[domain.Project]{
		domain.ProjectFieldCreatedAt: {
			SQLName:  "created_at",
			Accessor: func(p *domain.Project) any { return p.CreatedAt },
			Coerce:   database.CoerceTime,
		},
		domain.ProjectFieldID: {
			SQLName:  "id",
			Accessor: func(p *domain.Project) any { return p.ID },
			Coerce:   database.CoerceString,
		},
	})

	values, err := schema.CoerceCursorValues(
		[]database.Column[domain.ProjectField]{
			database.Col(domain.ProjectFieldCreatedAt),
			database.Col(domain.ProjectFieldID),
		},
		[]any{nil, "proj_1"},
	)
	require.NoError(t, err)
	require.Len(t, values, 2)
	assert.Nil(t, values[0])
	assert.Equal(t, "proj_1", values[1])
}

func TestSchemaCoerceCursorValues_invalidTime(t *testing.T) {
	t.Parallel()
	schema := database.NewSchema(map[domain.ProjectField]database.FieldBinding[domain.Project]{
		domain.ProjectFieldCreatedAt: {
			SQLName:  "created_at",
			Accessor: func(p *domain.Project) any { return p.CreatedAt },
			Coerce:   database.CoerceTime,
		},
	})

	_, err := schema.CoerceCursorValues(
		[]database.Column[domain.ProjectField]{database.Col(domain.ProjectFieldCreatedAt)},
		[]any{"not-a-time"},
	)
	assert.Error(t, err)
}

func TestSchemaUnknownFieldPanics(t *testing.T) {
	t.Parallel()
	schema := database.NewSchema(map[domain.ProjectField]database.FieldBinding[domain.Project]{
		domain.ProjectFieldID: {
			SQLName:  "id",
			Accessor: func(p *domain.Project) any { return p.ID },
			Coerce:   database.CoerceString,
		},
	})

	assert.Panics(t, func() {
		schema.SQLName(database.Col(domain.ProjectFieldUnspecified))
	})
}
