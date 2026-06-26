package database_test

import (
	"testing"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func TestColField(t *testing.T) {
	col := database.Col(domain.ProjectFieldID)
	if col.Field() != domain.ProjectFieldID {
		t.Fatalf("Field() = %v, want %v", col.Field(), domain.ProjectFieldID)
	}
}

func TestColumnEquality(t *testing.T) {
	a := database.Col(domain.ProjectFieldID)
	b := database.Col(domain.ProjectFieldID)
	c := database.Col(domain.ProjectFieldCreatedAt)

	if a != b {
		t.Fatal("expected equal columns to compare equal")
	}
	if a == c {
		t.Fatal("expected different columns to compare unequal")
	}
}

func TestColumnJSONRoundTrip(t *testing.T) {
	col := database.Col(domain.ProjectFieldUpdatedAt)
	data, err := col.MarshalJSON()
	if err != nil {
		t.Fatalf("MarshalJSON() error = %v", err)
	}

	var decoded database.Column[domain.ProjectField]
	if err := decoded.UnmarshalJSON(data); err != nil {
		t.Fatalf("UnmarshalJSON() error = %v", err)
	}
	if decoded != col {
		t.Fatalf("decoded = %+v, want %+v", decoded, col)
	}
}
