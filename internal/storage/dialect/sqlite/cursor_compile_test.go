package sqlite

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

func TestCompileReadKeysetCursorAsc(t *testing.T) {
	t.Parallel()

	createdAt := time.Date(2026, 6, 26, 10, 0, 0, 0, time.UTC)
	cols := []database.Column[domain.ProjectField]{
		database.Col(domain.ProjectFieldCreatedAt),
		database.Col(domain.ProjectFieldID),
	}
	cursor := pagination.New(database.OrderBy[domain.ProjectField]{
		Columns:   cols,
		Direction: database.OrderAsc,
	}, []any{createdAt, "proj_1"}).Marshal()

	sql, args := compileProjectRead(t, &database.ListOptions[domain.ProjectField]{
		Pagination: database.Page[domain.ProjectField]{
			Limit: 5,
			OrderBy: database.OrderBy[domain.ProjectField]{
				Columns:   cols,
				Direction: database.OrderAsc,
			},
			Cursor: cursor,
		},
	})

	assert.Contains(t, sql, "(created_at, id) > (?, ?)")
	require.Len(t, args, 3)
	assert.Equal(t, createdAt.UnixNano(), args[0])
	assert.Equal(t, "proj_1", args[1])
	assert.Equal(t, int64(5), args[2])
}

func TestCompileReadCursorDesc(t *testing.T) {
	t.Parallel()

	createdAt := time.Date(2026, 6, 26, 10, 0, 0, 0, time.UTC)
	cols := []database.Column[domain.ProjectField]{
		database.Col(domain.ProjectFieldCreatedAt),
		database.Col(domain.ProjectFieldID),
	}
	cursor := pagination.New(database.OrderBy[domain.ProjectField]{
		Columns:   cols,
		Direction: database.OrderDesc,
	}, []any{createdAt, "proj_1"}).Marshal()

	sql, args := compileProjectRead(t, &database.ListOptions[domain.ProjectField]{
		Pagination: database.Page[domain.ProjectField]{
			OrderBy: database.OrderBy[domain.ProjectField]{
				Columns:   cols,
				Direction: database.OrderDesc,
			},
			Cursor: cursor,
		},
	})

	assert.Contains(t, sql, "(created_at, id) < (?, ?)")
	require.Len(t, args, 2)
	assert.Equal(t, createdAt.UnixNano(), args[0])
	assert.Equal(t, "proj_1", args[1])
}

func TestCompileReadCursorDoesNotMutateCallerFilter(t *testing.T) {
	t.Parallel()

	createdAt := time.Date(2026, 6, 26, 10, 0, 0, 0, time.UTC)
	baseFilter := database.Equal(database.Col(domain.ProjectFieldID), "proj_1")
	cols := []database.Column[domain.ProjectField]{
		database.Col(domain.ProjectFieldCreatedAt),
		database.Col(domain.ProjectFieldID),
	}
	cursor := pagination.New(database.OrderBy[domain.ProjectField]{
		Columns:   cols,
		Direction: database.OrderAsc,
	}, []any{createdAt, "proj_1"}).Marshal()

	opts := &database.ListOptions[domain.ProjectField]{
		Filter: baseFilter,
		Pagination: database.Page[domain.ProjectField]{
			Limit: 5,
			OrderBy: database.OrderBy[domain.ProjectField]{
				Columns:   cols,
				Direction: database.OrderAsc,
			},
			Cursor: cursor,
		},
	}
	_, _ = compileProjectRead(t, opts)
	assert.Equal(t, baseFilter, opts.Filter)
}

func TestCompileReadCursorWithBaseFilter(t *testing.T) {
	t.Parallel()

	createdAt := time.Date(2026, 6, 26, 10, 0, 0, 0, time.UTC)
	cols := []database.Column[domain.ProjectField]{
		database.Col(domain.ProjectFieldCreatedAt),
		database.Col(domain.ProjectFieldID),
	}
	cursor := pagination.New(database.OrderBy[domain.ProjectField]{
		Columns:   cols,
		Direction: database.OrderAsc,
	}, []any{createdAt, "proj_1"}).Marshal()

	sql, args := compileProjectRead(t, &database.ListOptions[domain.ProjectField]{
		Filter: database.Equal(database.Col(domain.ProjectFieldID), "proj_1"),
		Pagination: database.Page[domain.ProjectField]{
			Limit: 5,
			OrderBy: database.OrderBy[domain.ProjectField]{
				Columns:   cols,
				Direction: database.OrderAsc,
			},
			Cursor: cursor,
		},
	})

	assert.Contains(t, sql, "WHERE (id = ? AND (created_at, id) > (?, ?))")
	require.Len(t, args, 4)
	assert.Equal(t, "proj_1", args[0])
	assert.Equal(t, createdAt.UnixNano(), args[1])
	assert.Equal(t, "proj_1", args[2])
	assert.Equal(t, int64(5), args[3])
}

func TestCompileReadInvalidCursorToken(t *testing.T) {
	t.Parallel()

	err := compileReadExpectError(t, testProjectQuery, &database.ListOptions[domain.ProjectField]{
		Pagination: database.Page[domain.ProjectField]{
			OrderBy: database.OrderBy[domain.ProjectField]{
				Columns: []database.Column[domain.ProjectField]{
					database.Col(domain.ProjectFieldID),
				},
			},
			Cursor: []byte("not-a-token"),
		},
	}, projectSchema)
	assertDatabaseErrorCode(t, err, "db.invalid_cursor")
}

func TestCompileReadCursorOrderMismatch(t *testing.T) {
	t.Parallel()

	createdAt := time.Date(2026, 6, 26, 10, 0, 0, 0, time.UTC)
	cursor := pagination.New(database.OrderBy[domain.ProjectField]{
		Columns: []database.Column[domain.ProjectField]{
			database.Col(domain.ProjectFieldCreatedAt),
			database.Col(domain.ProjectFieldID),
		},
		Direction: database.OrderAsc,
	}, []any{createdAt, "proj_1"}).Marshal()

	err := compileReadExpectError(t, testProjectQuery, &database.ListOptions[domain.ProjectField]{
		Pagination: database.Page[domain.ProjectField]{
			OrderBy: database.OrderBy[domain.ProjectField]{
				Columns: []database.Column[domain.ProjectField]{
					database.Col(domain.ProjectFieldID),
				},
				Direction: database.OrderAsc,
			},
			Cursor: cursor,
		},
	}, projectSchema)
	assertDatabaseErrorCode(t, err, "db.cursor_order_mismatch")
}

func TestCompileReadCursorDirectionMismatch(t *testing.T) {
	t.Parallel()

	createdAt := time.Date(2026, 6, 26, 10, 0, 0, 0, time.UTC)
	cols := []database.Column[domain.ProjectField]{
		database.Col(domain.ProjectFieldCreatedAt),
		database.Col(domain.ProjectFieldID),
	}
	cursor := pagination.New(database.OrderBy[domain.ProjectField]{
		Columns:   cols,
		Direction: database.OrderAsc,
	}, []any{createdAt, "proj_1"}).Marshal()

	err := compileReadExpectError(t, testProjectQuery, &database.ListOptions[domain.ProjectField]{
		Pagination: database.Page[domain.ProjectField]{
			OrderBy: database.OrderBy[domain.ProjectField]{
				Columns:   cols,
				Direction: database.OrderDesc,
			},
			Cursor: cursor,
		},
	}, projectSchema)
	assertDatabaseErrorCode(t, err, "db.cursor_order_mismatch")
}

func TestCompileReadCursorCoerceFailure(t *testing.T) {
	t.Parallel()

	cursor := pagination.New(database.OrderBy[domain.ProjectField]{
		Columns: []database.Column[domain.ProjectField]{
			database.Col(domain.ProjectFieldCreatedAt),
		},
		Direction: database.OrderAsc,
	}, []any{"not-a-time"}).Marshal()

	err := compileReadExpectError(t, testProjectQuery, &database.ListOptions[domain.ProjectField]{
		Pagination: database.Page[domain.ProjectField]{
			OrderBy: database.OrderBy[domain.ProjectField]{
				Columns: []database.Column[domain.ProjectField]{
					database.Col(domain.ProjectFieldCreatedAt),
				},
				Direction: database.OrderAsc,
			},
			Cursor: cursor,
		},
	}, projectSchema)
	assertDatabaseErrorCode(t, err, "db.invalid_cursor")
}

// compileWhereRest continues a WHERE the caller opened with arguments of its
// own: the list filter, then the keyset, numbered after the caller's.
func TestCompileWhereRestFollowsTheCallersPredicate(t *testing.T) {
	t.Parallel()

	byID := database.OrderBy[domain.ProjectField]{
		Columns:   []database.Column[domain.ProjectField]{database.Col(domain.ProjectFieldID)},
		Direction: database.OrderAsc,
	}
	cursor := pagination.New(byID, []any{"proj_1"}).Marshal()
	opened := func() *statementCompiler {
		var compiler statementCompiler
		compiler.WriteString(testProjectQuery + " WHERE id IN (")
		compiler.WriteArg("proj_0")
		compiler.WriteString(")")
		return &compiler
	}

	searched := opened()
	require.NoError(t, compileWhereRest(searched, &database.ListOptions[domain.ProjectField]{
		Filter:     database.StringContainsFold(database.Col(domain.ProjectFieldName), "acme"),
		Pagination: database.Page[domain.ProjectField]{Limit: 5, OrderBy: byID, Cursor: cursor},
	}, projectSchema))
	assert.Equal(t, testProjectQuery+" WHERE id IN (?) AND (LOWER(name) LIKE LOWER('%' || ? || '%') ESCAPE '\\' AND id > ?) ORDER BY id LIMIT ?", searched.String())
	assert.Equal(t, []any{"proj_0", "acme", "proj_1", int64(5)}, searched.args)

	// Neither a filter nor a cursor: no dangling AND.
	plain := opened()
	require.NoError(t, compileWhereRest(plain, &database.ListOptions[domain.ProjectField]{
		Pagination: database.Page[domain.ProjectField]{Limit: 5, OrderBy: byID},
	}, projectSchema))
	assert.Equal(t, testProjectQuery+" WHERE id IN (?) ORDER BY id LIMIT ?", plain.String())
}
