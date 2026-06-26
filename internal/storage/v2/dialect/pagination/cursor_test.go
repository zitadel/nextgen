package pagination_test

import (
	"testing"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/pagination"
)

func TestCursorMarshalRoundTrip(t *testing.T) {
	createdAt := time.Date(2026, 6, 26, 12, 0, 0, 0, time.UTC)
	original := &pagination.Cursor[domain.ProjectField]{
		Columns: []database.Column[domain.ProjectField]{
			database.Col(domain.ProjectFieldCreatedAt),
			database.Col(domain.ProjectFieldID),
		},
		Values: []any{createdAt, "proj_1"},
	}

	token := original.Marshal()
	decoded, err := pagination.CursorFromToken[domain.ProjectField](token)
	if err != nil {
		t.Fatalf("CursorFromToken() error = %v", err)
	}
	if !decoded.MatchesOrderBy(original.Columns) {
		t.Fatal("decoded cursor columns do not match original order by")
	}
	if len(decoded.Values) != 2 {
		t.Fatalf("decoded values len = %d, want 2", len(decoded.Values))
	}
}

func TestCursorMatchesOrderByMismatch(t *testing.T) {
	cursor := &pagination.Cursor[domain.ProjectField]{
		Columns: []database.Column[domain.ProjectField]{
			database.Col(domain.ProjectFieldCreatedAt),
		},
	}
	if cursor.MatchesOrderBy([]database.Column[domain.ProjectField]{
		database.Col(domain.ProjectFieldID),
	}) {
		t.Fatal("expected order by mismatch")
	}
}
