package database_test

import (
	"testing"
	"time"

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

	if got := schema.SQLName(database.Col(domain.ProjectFieldID)); got != "id" {
		t.Fatalf("SQLName() = %q, want id", got)
	}
	if got := schema.MustSQLName(domain.ProjectFieldCreatedAt); got != "created_at" {
		t.Fatalf("MustSQLName() = %q, want created_at", got)
	}

	values := schema.ValuesFrom(project, []database.Column[domain.ProjectField]{
		database.Col(domain.ProjectFieldID),
		database.Col(domain.ProjectFieldCreatedAt),
	})
	if len(values) != 2 || values[0] != "proj_1" || values[1] != createdAt {
		t.Fatalf("ValuesFrom() = %#v, want [proj_1, %v]", values, createdAt)
	}
}

func TestSchemaUnknownFieldPanics(t *testing.T) {
	schema := database.NewSchema(map[domain.ProjectField]database.FieldBinding[domain.Project]{
		domain.ProjectFieldID: {
			SQLName:  "id",
			Accessor: func(p *domain.Project) any { return p.ID },
		},
	})

	defer func() {
		if recover() == nil {
			t.Fatal("expected panic for unknown field")
		}
	}()
	schema.SQLName(database.Col(domain.ProjectFieldUnspecified))
}
