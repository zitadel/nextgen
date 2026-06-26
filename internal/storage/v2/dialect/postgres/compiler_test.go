package postgres

import (
	"strings"
	"testing"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
	"github.com/zitadel/nextgen/internal/storage/v2/dialect/pagination"
)

const testProjectQuery = "SELECT id, created_at, updated_at, project_secret, preview_secret, preview_origins FROM zitadel_nextgen.projects"

func TestCompileReadFilterAndOrderBy(t *testing.T) {
	t.Parallel()

	sql, args := compileProjectRead(t, &database.ListOptions[domain.ProjectField]{
		Filter: database.Equal(database.Col(domain.ProjectFieldID), "proj_1"),
		Pagination: database.Page[domain.ProjectField]{
			Limit: 10,
			OrderBy: database.OrderBy[domain.ProjectField]{
				Columns: []database.Column[domain.ProjectField]{
					database.Col(domain.ProjectFieldCreatedAt),
					database.Col(domain.ProjectFieldID),
				},
				Direction: database.OrderAsc,
			},
		},
	})

	wantSQL := testProjectQuery + " WHERE id = $1 ORDER BY created_at, id LIMIT $2"
	if sql != wantSQL {
		t.Fatalf("sql = %q, want %q", sql, wantSQL)
	}
	if len(args) != 2 || args[0] != "proj_1" || args[1] != uint32(10) {
		t.Fatalf("args = %#v, want [proj_1, 10]", args)
	}
}

func TestCompileReadKeysetCursorAsc(t *testing.T) {
	t.Parallel()

	createdAt := time.Date(2026, 6, 26, 10, 0, 0, 0, time.UTC)
	cursor := (&pagination.Cursor[domain.ProjectField]{
		Columns: []database.Column[domain.ProjectField]{
			database.Col(domain.ProjectFieldCreatedAt),
			database.Col(domain.ProjectFieldID),
		},
		Values: []any{createdAt, "proj_1"},
	}).Marshal()

	sql, args := compileProjectRead(t, &database.ListOptions[domain.ProjectField]{
		Pagination: database.Page[domain.ProjectField]{
			Limit: 5,
			OrderBy: database.OrderBy[domain.ProjectField]{
				Columns: []database.Column[domain.ProjectField]{
					database.Col(domain.ProjectFieldCreatedAt),
					database.Col(domain.ProjectFieldID),
				},
				Direction: database.OrderAsc,
			},
			Cursor: cursor,
		},
	})

	if !strings.Contains(sql, "(created_at, id) > ($1, $2)") {
		t.Fatalf("sql = %q, want keyset greater-than predicate", sql)
	}
	if len(args) != 3 {
		t.Fatalf("args len = %d, want 3", len(args))
	}
	if args[0] != createdAt.UTC().Format(time.RFC3339) || args[1] != "proj_1" || args[2] != uint32(5) {
		t.Fatalf("args = %#v", args)
	}
}

func compileProjectRead(t *testing.T, opts *database.ListOptions[domain.ProjectField]) (string, []any) {
	t.Helper()

	var compiler statementCompiler
	if err := compileRead(&compiler, testProjectQuery, opts, projectSchema); err != nil {
		t.Fatalf("compileRead() error = %v", err)
	}
	return compiler.String(), compiler.args
}
