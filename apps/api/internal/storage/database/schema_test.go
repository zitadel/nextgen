package database_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
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

func TestSchemaEnsureOrderable(t *testing.T) {
	t.Parallel()
	schema := database.NewSchema(map[domain.ProjectField]database.FieldBinding[domain.Project]{
		domain.ProjectFieldID: {
			SQLName:  "id",
			Accessor: func(p *domain.Project) any { return p.ID },
			Coerce:   database.CoerceString,
		},
		// Filter-only computed field: a SQL expression with no accessor, so a
		// keyset cursor cannot read a value for it. Ordering by it must be
		// refused, not left to panic during cursor marshaling (#850).
		domain.ProjectFieldName: {
			SQLName:  "name IS NOT NULL",
			Computed: true,
		},
	})

	orderable := database.OrderBy[domain.ProjectField]{
		Columns: []database.Column[domain.ProjectField]{database.Col(domain.ProjectFieldID)},
	}
	require.NoError(t, schema.EnsureOrderable(orderable))

	notOrderable := database.OrderBy[domain.ProjectField]{
		Columns: []database.Column[domain.ProjectField]{database.Col(domain.ProjectFieldName)},
	}
	err := schema.EnsureOrderable(notOrderable)
	var de database.Error
	require.ErrorAs(t, err, &de)
	assert.Equal(t, database.ErrFieldNotOrderable(nil).Code, de.Code, "typed not-orderable code")
	assert.Equal(t, domain.ProjectFieldName, de.Details, "details identify the offending field")
}

func TestSchemaColumnNullability(t *testing.T) {
	t.Parallel()
	schema := database.NewSchema(map[domain.ProjectField]database.FieldBinding[domain.Project]{
		domain.ProjectFieldID: {
			SQLName:  "id",
			Accessor: func(p *domain.Project) any { return p.ID },
			Coerce:   database.CoerceString,
		},
		domain.ProjectFieldName: {
			SQLName:  "name",
			Accessor: func(p *domain.Project) any { return p.Name },
			Coerce:   database.CoerceString,
			Nullable: true,
		},
		domain.ProjectFieldCreatedAt: {
			SQLName:  "name IS NOT NULL",
			Computed: true,
		},
	})

	assert.Equal(t, map[string]bool{"id": false, "name": true}, schema.ColumnNullability())
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
