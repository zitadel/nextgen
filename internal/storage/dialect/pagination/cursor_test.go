package pagination_test

import (
	"encoding/base64"
	"encoding/json"
	"math"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/zitadel/v5/internal/domain"
	"github.com/zitadel/zitadel/v5/internal/storage/database"
	"github.com/zitadel/zitadel/v5/internal/storage/dialect/pagination"
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

func TestPage(t *testing.T) {
	t.Parallel()
	schema := database.NewSchema(map[domain.ProjectField]database.FieldBinding[domain.Project]{
		domain.ProjectFieldID: {
			SQLName:  "id",
			Accessor: func(p *domain.Project) any { return p.ID },
			Coerce:   database.CoerceString,
		},
	})
	orderBy := database.OrderBy[domain.ProjectField]{
		Columns:   []database.Column[domain.ProjectField]{database.Col(domain.ProjectFieldID)},
		Direction: database.OrderAsc,
	}
	ids := func(ps []*domain.Project) []string {
		out := make([]string, len(ps))
		for i, p := range ps {
			out[i] = p.ID
		}
		return out
	}
	all := []*domain.Project{{ID: "proj_1"}, {ID: "proj_2"}, {ID: "proj_3"}}
	// source models a LIMIT query over data: it returns at most `limit` rows.
	source := func(data []*domain.Project) func(uint32) ([]*domain.Project, error) {
		return func(limit uint32) ([]*domain.Project, error) {
			if limit == 0 || int(limit) > len(data) {
				return data, nil
			}
			return data[:limit], nil
		}
	}
	pageOf := func(limit uint32) database.Page[domain.ProjectField] {
		return database.Page[domain.ProjectField]{Limit: limit, OrderBy: orderBy}
	}

	// A further row exists: Page fetches the probe (limit+1), trims it, and
	// tokenizes from the last kept row.
	var gotFetch uint32
	page, token, err := pagination.Page(pageOf(2), schema, func(limit uint32) ([]*domain.Project, error) {
		gotFetch = limit
		return source(all)(limit)
	})
	require.NoError(t, err)
	assert.Equal(t, uint32(3), gotFetch, "fetches limit+1 as the look-ahead probe")
	assert.Equal(t, []string{"proj_1", "proj_2"}, ids(page), "probe row dropped")
	require.NotEmpty(t, token)
	decoded, err := pagination.CursorFromToken[domain.ProjectField](token)
	require.NoError(t, err)
	assert.True(t, decoded.MatchesOrderBy(orderBy))
	assert.Equal(t, []any{"proj_2"}, decoded.Values, "token resumes after the last kept row")

	// Exactly limit rows exist: the probe finds none, so this is the final page
	// and no token is emitted (#849).
	page, token, err = pagination.Page(pageOf(2), schema, source(all[:2]))
	require.NoError(t, err)
	assert.Equal(t, []string{"proj_1", "proj_2"}, ids(page))
	assert.Nil(t, token, "exact-multiple final page emits no token")

	page, token, err = pagination.Page(pageOf(2), schema, source(all[:1]))
	require.NoError(t, err)
	assert.Equal(t, []string{"proj_1"}, ids(page))
	assert.Nil(t, token, "short page")

	page, token, err = pagination.Page(pageOf(0), schema, source(all))
	require.NoError(t, err)
	assert.Equal(t, all, page)
	assert.Nil(t, token, "zero limit is unbounded")

	// No OrderBy: there is no keyset to resume, so Page skips the probe,
	// fetches exactly the limit, and emits no token.
	page, token, err = pagination.Page(database.Page[domain.ProjectField]{Limit: 2}, schema, func(limit uint32) ([]*domain.Project, error) {
		gotFetch = limit
		return source(all)(limit)
	})
	require.NoError(t, err)
	assert.Equal(t, uint32(2), gotFetch, "empty OrderBy skips the look-ahead probe")
	assert.Equal(t, []string{"proj_1", "proj_2"}, ids(page))
	assert.Nil(t, token, "empty OrderBy has no keyset")

	// The maximum limit cannot be probed: limit+1 is unrepresentable, so Page
	// fetches the limit as-is and emits no token, since no result set holds a
	// further page beyond 2^32 rows.
	page, token, err = pagination.Page(pageOf(math.MaxUint32), schema, func(limit uint32) ([]*domain.Project, error) {
		gotFetch = limit
		return source(all)(limit)
	})
	require.NoError(t, err)
	assert.Equal(t, uint32(math.MaxUint32), gotFetch, "the max limit is fetched without +1")
	assert.Equal(t, all, page)
	assert.Nil(t, token, "the max limit has no successor page")

	_, _, err = pagination.Page(pageOf(2), schema, func(uint32) ([]*domain.Project, error) {
		return nil, assert.AnError
	})
	require.ErrorIs(t, err, assert.AnError, "run errors propagate")
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
