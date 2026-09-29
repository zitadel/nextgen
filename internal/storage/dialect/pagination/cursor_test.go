package pagination_test

import (
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

func TestCursorMarshalRoundTrip(t *testing.T) {
	t.Parallel()
	createdAt := time.Date(2026, 6, 26, 12, 0, 0, 0, time.UTC)
	orderBy := database.OrderBy[domain.ProjectField]{
		Columns: []database.Column[domain.ProjectField]{
			database.Col(domain.ProjectFieldCreatedAt),
			database.Col(domain.ProjectFieldID),
		},
		Direction: database.OrderDesc,
	}
	original := pagination.New(orderBy, []any{createdAt, "proj_1"})

	token := original.Marshal()
	decoded, err := pagination.CursorFromToken[domain.ProjectField](token)
	require.NoError(t, err)
	assert.True(t, decoded.MatchesOrderBy(orderBy))
	assert.Equal(t, database.OrderDesc, decoded.Direction)
	require.Len(t, decoded.Values, 2)
	assert.IsType(t, "", decoded.Values[0], "json round-trip leaves time values as strings before schema coercion")
}

func TestCursorMatchesOrderByColumnMismatch(t *testing.T) {
	t.Parallel()
	cursor := pagination.New(database.OrderBy[domain.ProjectField]{
		Columns: []database.Column[domain.ProjectField]{
			database.Col(domain.ProjectFieldCreatedAt),
		},
		Direction: database.OrderAsc,
	}, nil)
	assert.False(t, cursor.MatchesOrderBy(database.OrderBy[domain.ProjectField]{
		Columns: []database.Column[domain.ProjectField]{
			database.Col(domain.ProjectFieldID),
		},
		Direction: database.OrderAsc,
	}))
}

func TestCursorMatchesOrderByDirectionMismatch(t *testing.T) {
	t.Parallel()
	cols := []database.Column[domain.ProjectField]{
		database.Col(domain.ProjectFieldCreatedAt),
	}
	cursor := pagination.New(database.OrderBy[domain.ProjectField]{
		Columns:   cols,
		Direction: database.OrderAsc,
	}, nil)
	assert.False(t, cursor.MatchesOrderBy(database.OrderBy[domain.ProjectField]{
		Columns:   cols,
		Direction: database.OrderDesc,
	}))
}

func TestCursorMatchesOrderByEmptyColumns(t *testing.T) {
	t.Parallel()
	cursor := &pagination.Cursor[domain.ProjectField]{
		Direction: database.OrderAsc,
	}
	assert.False(t, cursor.MatchesOrderBy(database.OrderBy[domain.ProjectField]{
		Direction: database.OrderAsc,
	}))
}

func TestPaginate(t *testing.T) {
	t.Parallel()
	schema := database.NewSchema(map[domain.ProjectField]database.FieldBinding[domain.Project]{
		domain.ProjectFieldID: {
			SQLName:  "id",
			Accessor: func(p *domain.Project) any { return p.ID },
			Coerce:   database.CoerceString,
		},
	})
	orderBy := database.OrderBy[domain.ProjectField]{
		Columns: []database.Column[domain.ProjectField]{
			database.Col(domain.ProjectFieldID),
		},
		Direction: database.OrderAsc,
	}
	ids := func(ps []*domain.Project) []string {
		out := make([]string, len(ps))
		for i, p := range ps {
			out[i] = p.ID
		}
		return out
	}

	// A probe row came back (limit+1): trim it, tokenize from the last kept row.
	overFetched := []*domain.Project{{ID: "proj_1"}, {ID: "proj_2"}, {ID: "proj_3"}}
	page, token := pagination.Paginate(orderBy, overFetched, schema, 2)
	assert.Equal(t, []string{"proj_1", "proj_2"}, ids(page), "probe row dropped")
	require.NotEmpty(t, token)
	decoded, err := pagination.CursorFromToken[domain.ProjectField](token)
	require.NoError(t, err)
	assert.True(t, decoded.MatchesOrderBy(orderBy))
	assert.Equal(t, []any{"proj_2"}, decoded.Values, "token resumes after the last kept row")

	// Exactly limit rows and no probe: this is the final page (#849). A
	// page-full heuristic wrongly tokenized here.
	exact := []*domain.Project{{ID: "proj_1"}, {ID: "proj_2"}}
	page, token = pagination.Paginate(orderBy, exact, schema, 2)
	assert.Equal(t, []string{"proj_1", "proj_2"}, ids(page))
	assert.Nil(t, token, "exact-multiple final page emits no token")

	page, token = pagination.Paginate(orderBy, exact[:1], schema, 2)
	assert.Equal(t, []string{"proj_1"}, ids(page))
	assert.Nil(t, token, "short page")

	page, token = pagination.Paginate(orderBy, exact, schema, 0)
	assert.Equal(t, exact, page)
	assert.Nil(t, token, "zero limit is unbounded")

	// No OrderBy: a bounded read still trims to the limit, but has no keyset to
	// tokenize, so no token.
	page, token = pagination.Paginate(database.OrderBy[domain.ProjectField]{Direction: database.OrderAsc}, overFetched, schema, 2)
	assert.Equal(t, []string{"proj_1", "proj_2"}, ids(page))
	assert.Nil(t, token, "empty OrderBy has no keyset")
}

func TestCursorMissingDirectionJSONTreatsAsAsc(t *testing.T) {
	t.Parallel()
	// Pre-direction tokens omit "direction"; JSON unmarshals it as 0 (OrderAsc).
	cols := []database.Column[domain.ProjectField]{
		database.Col(domain.ProjectFieldID),
	}
	payload, err := json.Marshal(map[string]any{
		"columns": cols,
		"values":  []any{"proj_1"},
	})
	require.NoError(t, err)
	token := []byte(base64.RawURLEncoding.EncodeToString(payload))
	decoded, err := pagination.CursorFromToken[domain.ProjectField](token)
	require.NoError(t, err)
	assert.Equal(t, database.OrderAsc, decoded.Direction)
	assert.True(t, decoded.MatchesOrderBy(database.OrderBy[domain.ProjectField]{
		Columns:   cols,
		Direction: database.OrderAsc,
	}))
	assert.False(t, decoded.MatchesOrderBy(database.OrderBy[domain.ProjectField]{
		Columns:   cols,
		Direction: database.OrderDesc,
	}))
}
