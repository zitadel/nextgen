package user_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/user"
)

func TestSearchBounds(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name, prefix, upper string
		bounded             bool
	}{
		{"ascii", "ann", "ano", true},
		{"at sign", "ann@", "annA", true},
		{"multi-byte rune", "é", "ê", true},
		{"steps over the surrogates", "a퟿", "a", true},
		{"carries past the highest code point", "a\U0010FFFF", "b", true},
		{"only the highest code point", "\U0010FFFF", "", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			lower, upper, bounded := user.SearchBounds(tc.prefix)
			assert.Equal(t, tc.prefix, lower)
			assert.Equal(t, tc.upper, upper)
			assert.Equal(t, tc.bounded, bounded)
			if bounded {
				// Everything that starts with the prefix lies inside the range.
				assert.Less(t, tc.prefix+"\U0010FFFF\U0010FFFF", upper)
			}
		})
	}
}

func TestSearchLower(t *testing.T) {
	t.Parallel()

	token := func(values ...any) []byte {
		return pagination.New(user.SearchOrder(), values).Marshal()
	}
	page := func(cursor []byte) database.Page[domain.UserField] {
		return database.Page[domain.UserField]{Cursor: cursor, OrderBy: user.SearchOrder()}
	}

	lower, err := user.SearchLower("ann", page(nil))
	require.NoError(t, err)
	assert.Equal(t, "ann", lower, "the first page starts at the prefix")

	lower, err = user.SearchLower("ann", page(token("anna@example.com", "user_1")))
	require.NoError(t, err)
	assert.Equal(t, "anna@example.com", lower, "a later page starts at the text the token stopped at")

	for name, cursor := range map[string][]byte{
		"not a token":       []byte("%%%"),
		"no values":         token(),
		"text not a string": token(42, "user_1"),
	} {
		_, err := user.SearchLower("ann", page(cursor))
		require.ErrorIs(t, err, database.ErrInvalidCursor(), name)
	}
}

func TestMergeSearchPages(t *testing.T) {
	t.Parallel()

	match := func(text, id string) *domain.User { return &domain.User{ID: id, MatchedText: text} }
	ids := func(users []*domain.User) []string {
		out := make([]string, len(users))
		for i, u := range users {
			out[i] = u.ID + ":" + u.MatchedText
		}
		return out
	}
	email := []*domain.User{match("sam@example.com", "user_b"), match("sara@example.com", "user_a")}
	name := []*domain.User{match("sam", "user_c"), match("sam", "user_d"), match("sara@example.com", "user_0")}

	assert.Equal(t, []string{"user_c:sam", "user_d:sam", "user_b:sam@example.com", "user_0:sara@example.com", "user_a:sara@example.com"},
		ids(user.MergeSearchPages([][]*domain.User{email, name}, 0)))
	assert.Equal(t, []string{"user_c:sam", "user_d:sam"}, ids(user.MergeSearchPages([][]*domain.User{email, name}, 2)))
	assert.Equal(t, []string{"user_b:sam@example.com", "user_a:sara@example.com"}, ids(user.MergeSearchPages([][]*domain.User{email}, 5)))
	assert.Empty(t, user.MergeSearchPages(nil, 5))
}

func TestListOptions(t *testing.T) {
	t.Parallel()

	byID := database.OrderBy[domain.UserField]{Columns: []database.Column[domain.UserField]{database.Col(domain.UserFieldID)}}

	opts, err := user.ListOptions(&database.ListOptions[domain.UserField]{Pagination: database.Page[domain.UserField]{OrderBy: byID}}, true)
	require.NoError(t, err)
	assert.Equal(t, user.SearchOrder(), opts.Pagination.OrderBy, "a search read has one order")

	opts, err = user.ListOptions(&database.ListOptions[domain.UserField]{Pagination: database.Page[domain.UserField]{OrderBy: byID}}, false)
	require.NoError(t, err)
	assert.Equal(t, byID, opts.Pagination.OrderBy)

	_, err = user.ListOptions(&database.ListOptions[domain.UserField]{Pagination: database.Page[domain.UserField]{OrderBy: user.SearchOrder()}}, false)
	require.Error(t, err, "the search fields name columns only a search read has")
}

// A search read returns a user once per attribute matched. Hydration loads
// the user once and every row gets it.
func TestGroupByProject_RepeatedUser(t *testing.T) {
	t.Parallel()

	first := &domain.User{ProjectID: "p", ID: "u1", MatchedText: "ann"}
	again := &domain.User{ProjectID: "p", ID: "u1", MatchedText: "ann@example.com"}
	other := &domain.User{ProjectID: "p", ID: "u2"}

	groups := user.GroupByProject([]*domain.User{first, again, other})
	require.Len(t, groups, 1)
	assert.Equal(t, []string{"u1", "u2"}, groups[0].IDs, "one id per user for the hydrating read")
	assert.Same(t, first, groups[0].ByID["u1"])

	first.Attributes = domain.Attributes{{Key: "email", Value: "ann@example.com"}}
	user.FillRepeats(groups)
	assert.Equal(t, first.Attributes, again.Attributes)
	assert.Equal(t, "ann@example.com", again.MatchedText, "each row keeps the text it matched on")
}
