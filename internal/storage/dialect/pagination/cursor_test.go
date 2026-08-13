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

func TestMarshalNext(t *testing.T) {
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
	items := []*domain.Project{{ID: "proj_1"}, {ID: "proj_2"}}

	token := pagination.MarshalNext(orderBy, items, schema, 2)
	require.NotEmpty(t, token)
	decoded, err := pagination.CursorFromToken[domain.ProjectField](token)
	require.NoError(t, err)
	assert.True(t, decoded.MatchesOrderBy(orderBy))
	assert.Equal(t, []any{"proj_2"}, decoded.Values)

	assert.Nil(t, pagination.MarshalNext(orderBy, items[:1], schema, 2), "short page")
	assert.Nil(t, pagination.MarshalNext(orderBy, items, schema, 0), "zero limit")
	assert.Nil(t, pagination.MarshalNext(orderBy, nil, schema, 2), "empty items")
	assert.Nil(t, pagination.MarshalNext(database.OrderBy[domain.ProjectField]{
		Direction: database.OrderAsc,
	}, items, schema, 2), "empty OrderBy")
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
