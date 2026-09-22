package configfs

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/storage/database"
)

type row struct {
	Project string
	Name    string
	Group   *string
	Created time.Time
	Tags    []string
	Roles   map[string]string
}

type rowField uint8

const (
	rowProject rowField = iota
	rowName
	rowGroup
	rowCreated
	rowTags
	rowRoles
)

var rowSchema = database.NewSchema(map[rowField]database.FieldBinding[row]{
	rowProject: {
		SQLName:  "project",
		Accessor: func(r *row) any { return r.Project },
		Coerce:   database.CoerceString,
	},
	rowName: {
		SQLName:  "name",
		Accessor: func(r *row) any { return r.Name },
		Coerce:   database.CoerceString,
	},
	rowGroup: {
		SQLName:  "group",
		Accessor: func(r *row) any { return database.NullableValue(r.Group) },
		Coerce:   database.CoerceString,
		Nullable: true,
	},
	rowCreated: {
		SQLName:  "created",
		Accessor: func(r *row) any { return r.Created },
		Coerce:   database.CoerceTime,
	},
	rowTags: {
		SQLName:  "tags",
		Accessor: func(r *row) any { return r.Tags },
		Coerce:   database.CoerceString,
	},
	rowRoles: {
		SQLName:  "roles",
		Accessor: func(r *row) any { return r.Roles },
		Coerce:   database.CoerceString,
	},
})

func ptr(s string) *string { return &s }

func rows() []*row {
	base := time.Date(2026, 9, 18, 10, 0, 0, 0, time.UTC)
	return []*row{
		{Project: "p1", Name: "c", Group: ptr("g2"), Created: base.Add(2 * time.Hour), Tags: []string{"blue"}},
		{Project: "p1", Name: "a", Group: ptr("g1"), Created: base, Tags: []string{"red", "blue"}},
		{Project: "p2", Name: "d", Group: nil, Created: base.Add(3 * time.Hour)},
		{Project: "p1", Name: "b", Group: nil, Created: base.Add(time.Hour), Roles: map[string]string{"admin": "yes"}},
	}
}

func names(t *testing.T, res *database.ListResult[*row]) []string {
	t.Helper()
	out := make([]string, 0, len(res.Items))
	for _, r := range res.Items {
		out = append(out, r.Name)
	}
	return out
}

func TestQueryFiltersAndOrders(t *testing.T) {
	t.Parallel()

	t.Run("equality narrows to one project", func(t *testing.T) {
		res, err := query(rows(), &database.ListOptions[rowField]{
			Filter: database.Equal(database.Col(rowProject), "p1"),
			Pagination: database.Page[rowField]{
				OrderBy: database.OrderBy[rowField]{Columns: []database.Column[rowField]{database.Col(rowName)}},
			},
		}, rowSchema)
		require.NoError(t, err)
		assert.Equal(t, []string{"a", "b", "c"}, names(t, res))
	})

	t.Run("descending reverses", func(t *testing.T) {
		res, err := query(rows(), &database.ListOptions[rowField]{
			Pagination: database.Page[rowField]{
				OrderBy: database.OrderBy[rowField]{
					Columns:   []database.Column[rowField]{database.Col(rowName)},
					Direction: database.OrderDesc,
				},
			},
		}, rowSchema)
		require.NoError(t, err)
		assert.Equal(t, []string{"d", "c", "b", "a"}, names(t, res))
	})

	// NULL sorts smallest, so ascending puts it first: the ASC NULLS FIRST /
	// DESC NULLS LAST the SQL dialects emit (stated per FieldBinding).
	t.Run("nulls order first ascending", func(t *testing.T) {
		res, err := query(rows(), &database.ListOptions[rowField]{
			Pagination: database.Page[rowField]{
				OrderBy: database.OrderBy[rowField]{Columns: []database.Column[rowField]{database.Col(rowGroup)}},
			},
		}, rowSchema)
		require.NoError(t, err)
		got := names(t, res)
		assert.ElementsMatch(t, []string{"b", "d"}, got[:2], "the two nulls first")
		assert.Equal(t, "a", got[2], "then g1")
		assert.Equal(t, "c", got[3], "then g2")
	})

	t.Run("an and of predicates narrows further", func(t *testing.T) {
		res, err := query(rows(), &database.ListOptions[rowField]{
			Filter: database.And(
				database.Equal(database.Col(rowProject), "p1"),
				database.StringStartsWith(database.Col(rowName), "b"),
			),
			Pagination: database.Page[rowField]{
				OrderBy: database.OrderBy[rowField]{Columns: []database.Column[rowField]{database.Col(rowName)}},
			},
		}, rowSchema)
		require.NoError(t, err)
		assert.Equal(t, []string{"b"}, names(t, res))
	})

	// The flow engine selects a definition by the purposes it serves, which is
	// a collection column. A store that could not answer that cannot serve a
	// login page.
	t.Run("array-contains matches a collection member", func(t *testing.T) {
		res, err := query(rows(), &database.ListOptions[rowField]{
			Filter: database.ArrayContains(database.Col(rowTags), "blue"),
			Pagination: database.Page[rowField]{
				OrderBy: database.OrderBy[rowField]{Columns: []database.Column[rowField]{database.Col(rowName)}},
			},
		}, rowSchema)
		require.NoError(t, err)
		assert.Equal(t, []string{"a", "c"}, names(t, res))
	})

	// Keys are a map's elements: `purposes` is keyed by purpose, and the
	// question asked of it is whether one is present.
	t.Run("array-contains matches a map key", func(t *testing.T) {
		res, err := query(rows(), &database.ListOptions[rowField]{
			Filter: database.ArrayContains(database.Col(rowRoles), "admin"),
			Pagination: database.Page[rowField]{
				OrderBy: database.OrderBy[rowField]{Columns: []database.Column[rowField]{database.Col(rowName)}},
			},
		}, rowSchema)
		require.NoError(t, err)
		assert.Equal(t, []string{"b"}, names(t, res))
	})

	// A predicate this engine cannot evaluate must still fail the read rather
	// than be dropped: a silently ignored filter returns rows the caller
	// excluded, and for an authorization predicate that is a leak.
	t.Run("an unsupported filter errors", func(t *testing.T) {
		_, err := query(rows(), &database.ListOptions[rowField]{
			Filter: database.CorrelatedEqual(database.Col(rowName), "a"),
			Pagination: database.Page[rowField]{
				OrderBy: database.OrderBy[rowField]{Columns: []database.Column[rowField]{database.Col(rowName)}},
			},
		}, rowSchema)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "unsupported filter")
	})
}

// TestQueryDrainsEveryRowExactlyOnce is the cursor contract: walking pages to
// exhaustion must yield every row once, in order, in both directions, and stop.
// It is the in-memory analogue of the cursor battle the SQL dialects run.
func TestQueryDrainsEveryRowExactlyOnce(t *testing.T) {
	t.Parallel()

	// Every case ends on a unique column. A keyset cannot separate two rows that
	// tie on every ordered column, so callers order by a unique one last; these
	// mirror that rather than testing a shape no caller produces.
	for _, tc := range []struct {
		name      string
		direction database.OrderDirection
		columns   []rowField
		want      []string
	}{
		{"ascending by name", database.OrderAsc, []rowField{rowName}, []string{"a", "b", "c", "d"}},
		{"descending by name", database.OrderDesc, []rowField{rowName}, []string{"d", "c", "b", "a"}},
		{"ascending by created", database.OrderAsc, []rowField{rowCreated}, []string{"a", "b", "c", "d"}},
		{"descending by created", database.OrderDesc, []rowField{rowCreated}, []string{"d", "c", "b", "a"}},
		// The nullable column drains too: the keyset has to walk past NULLs
		// rather than stall on them or repeat them.
		{"ascending by nullable group", database.OrderAsc, []rowField{rowGroup, rowName}, []string{"b", "d", "a", "c"}},
		{"descending by nullable group", database.OrderDesc, []rowField{rowGroup, rowName}, []string{"c", "a", "d", "b"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			cols := make([]database.Column[rowField], len(tc.columns))
			for i, f := range tc.columns {
				cols[i] = database.Col(f)
			}

			var drained []string
			var cursor []byte
			for page := 0; ; page++ {
				require.Less(t, page, 10, "draining did not terminate")
				res, err := query(rows(), &database.ListOptions[rowField]{
					Pagination: database.Page[rowField]{
						Limit:   1,
						Cursor:  cursor,
						OrderBy: database.OrderBy[rowField]{Columns: cols, Direction: tc.direction},
					},
				}, rowSchema)
				require.NoError(t, err)
				drained = append(drained, names(t, res)...)
				if len(res.NextCursor) == 0 {
					break
				}
				cursor = res.NextCursor
			}

			assert.Len(t, drained, 4, "every row exactly once")
			assert.ElementsMatch(t, []string{"a", "b", "c", "d"}, drained)
			if tc.want != nil {
				assert.Equal(t, tc.want, drained, "order preserved across pages")
			}
		})
	}
}

// A token minted for one sort must not silently page a different one.
func TestQueryRejectsAForeignCursor(t *testing.T) {
	t.Parallel()

	asc := database.OrderBy[rowField]{Columns: []database.Column[rowField]{database.Col(rowName)}}
	first, err := query(rows(), &database.ListOptions[rowField]{
		Pagination: database.Page[rowField]{Limit: 1, OrderBy: asc},
	}, rowSchema)
	require.NoError(t, err)
	require.NotEmpty(t, first.NextCursor)

	_, err = query(rows(), &database.ListOptions[rowField]{
		Pagination: database.Page[rowField]{
			Limit:   1,
			Cursor:  first.NextCursor,
			OrderBy: database.OrderBy[rowField]{Columns: []database.Column[rowField]{database.Col(rowCreated)}},
		},
	}, rowSchema)
	require.Error(t, err)
}
