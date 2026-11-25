package domain

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestNormalizeSearchQuery(t *testing.T) {
	assert.Equal(t, "ann lee", NormalizeSearchQuery("  ann lee\t"))
	assert.Empty(t, NormalizeSearchQuery(" \n "))
}

func TestSearchQueryLongEnoughForUsers(t *testing.T) {
	assert.False(t, SearchQueryLongEnoughForUsers("an"))
	assert.True(t, SearchQueryLongEnoughForUsers("ann"))
	// Counted in characters, not bytes.
	assert.False(t, SearchQueryLongEnoughForUsers("äö"))
	assert.True(t, SearchQueryLongEnoughForUsers("äöü"))
}

func TestIsSearchID(t *testing.T) {
	tests := []struct {
		name   string
		prefix ResourcePrefix
		query  string
		want   bool
	}{
		{"an id", PrefixUser, "user_01KWH3B72K7M7F0N9WD3P2E4YM", true},
		{"a seeded id", PrefixTeam, "team_platform-1", true},
		{"another type's id", PrefixUser, "team_01KZZY8PX8K8ATNVDSMRCZY4N1", false},
		{"the prefix alone", PrefixUser, "user_", false},
		{"an email that starts like an id", PrefixUser, "user_1@example.com", false},
		{"text with a space", PrefixTeam, "team_ rocket", false},
		{"plain text", PrefixUser, "ann", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, IsSearchID(tt.prefix, tt.query))
		})
	}
}

func TestRankSearchText(t *testing.T) {
	tests := []struct {
		name   string
		query  string
		values []string
		want   SearchRank
	}{
		{"the whole value, any case", "Ann@Example.com", []string{"ann@example.com"}, SearchRankWhole},
		{"a prefix", "ann", []string{"Ann Lee"}, SearchRankPrefix},
		{"a substring", "ann", []string{"Joann"}, SearchRankContains},
		{"no match", "ann", []string{"Bob"}, SearchRankNone},
		{"the best of several values", "acme", []string{"Login with Acme", "acme"}, SearchRankWhole},
		{"an empty value never matches", "", []string{""}, SearchRankNone},
		{"no values", "ann", nil, SearchRankNone},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, RankSearchText(tt.query, tt.values...))
		})
	}
}

func TestBestSearchResults(t *testing.T) {
	candidates := []SearchResult{
		{ID: "user_3", Title: "Joann", Rank: SearchRankContains},
		{ID: "user_2", Title: "annika", Rank: SearchRankPrefix},
		{ID: "user_1", Title: "Ann", Rank: SearchRankPrefix},
		{ID: "user_4", Title: "ann", Rank: SearchRankWhole},
	}

	best, more := BestSearchResults(candidates, 3)

	assert.True(t, more)
	assert.Equal(t, []string{"user_4", "user_1", "user_2"}, searchResultIDs(best))

	all, more := BestSearchResults(best, 3)
	assert.False(t, more)
	assert.Len(t, all, 3)
}

func TestSortSearchResults(t *testing.T) {
	results := []SearchResult{
		{Type: SearchResultTypeUser, ID: "user_1", Title: "Joann", Rank: SearchRankContains},
		{Type: SearchResultTypeTeam, ID: "team_2", Title: "Annex", Rank: SearchRankPrefix},
		{Type: SearchResultTypeTeam, ID: "team_1", Title: "Ann", Rank: SearchRankWhole},
		{Type: SearchResultTypeUser, ID: "user_2", Title: "Zed Ann", Rank: SearchRankPrefix},
	}

	SortSearchResults(results, []SearchResultType{SearchResultTypeUser, SearchResultTypeTeam})

	// The better match first whatever its type; equal matches in the order of
	// the requested types.
	assert.Equal(t, []string{"team_1", "user_2", "team_2", "user_1"}, searchResultIDs(results))
}

func searchResultIDs(results []SearchResult) []string {
	ids := make([]string, 0, len(results))
	for _, result := range results {
		ids = append(ids, result.ID)
	}
	return ids
}

func TestIsSearchSchemaID(t *testing.T) {
	t.Parallel()
	for query, want := range map[string]bool{
		"sch_01KWH3B72K7M7F0N9WD3P2E4YM":                  true,
		"https://search.example.com/schemas/partner.json": true,
		"urn:example:schema:partner":                      true,
		"partner":                                         false,
		"partner-staff":                                   false,
		"ann@example.com":                                 false,
		"/schemas/partner.json":                           false,
		"https://example.com/a b":                         false,
	} {
		assert.Equal(t, want, IsSearchSchemaID(query), query)
	}
}
