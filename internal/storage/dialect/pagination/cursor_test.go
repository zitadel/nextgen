package pagination_test

import (
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
