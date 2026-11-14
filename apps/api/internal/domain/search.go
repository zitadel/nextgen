package domain

import (
	"cmp"
	"net/url"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"
)

// SearchResultType names a kind of resource search finds (ADR 087).
type SearchResultType string

const (
	SearchResultTypeUser           SearchResultType = "user"
	SearchResultTypeTeam           SearchResultType = "team"
	SearchResultTypeSchema         SearchResultType = "schema"
	SearchResultTypeFlowDefinition SearchResultType = "flow_definition"
	SearchResultTypeIDP            SearchResultType = "idp"
)

const (
	// SearchUserMinLength is the shortest text users are searched for. The
	// search index answers any length at the same cost; a shorter text just
	// starts too many identifiers and names to tell users apart.
	SearchUserMinLength = 3
	// SearchReadLimit is how many rows one type's read returns to rank from.
	SearchReadLimit = 100
)

// SearchRank says how well a result matches the text; lower is better.
type SearchRank uint8

const (
	// SearchRankID is the resource whose id the text is.
	SearchRankID SearchRank = iota
	SearchRankWhole
	SearchRankPrefix
	SearchRankContains
	// SearchRankNone is no match among the values compared.
	SearchRankNone
)

// SearchResult is one match: a reference to a resource, not the resource.
type SearchResult struct {
	Type      SearchResultType
	ID        string
	ProjectID string
	Title     string
	// Subtitle tells two titles apart; empty when there is nothing to add.
	Subtitle string
	Rank     SearchRank
}

// NormalizeSearchQuery is the text as it is matched: without the spaces
// around it. Empty means there is nothing to search for.
func NormalizeSearchQuery(query string) string {
	return strings.TrimSpace(query)
}

// SearchQueryLongEnoughForUsers reports whether query is long enough to match
// users by text.
func SearchQueryLongEnoughForUsers(query string) bool {
	return utf8.RuneCountInString(query) >= SearchUserMinLength
}

// IsSearchID reports whether query has the shape of an id under prefix: the
// prefix, "_", then only characters an id is made of. A value such as
// "user_1@example.com" is text, not an id.
func IsSearchID(prefix ResourcePrefix, query string) bool {
	if !prefix.Matches(query) {
		return false
	}
	for _, r := range query[len(prefix)+1:] {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '_', r == '-':
		default:
			return false
		}
	}
	return true
}

// IsSearchSchemaID reports whether query has the shape of a schema's id: one
// the server minted (see [IsSearchID]), or the absolute URI a schema document
// names as its `$id`. Other text is not worth a read by id.
func IsSearchSchemaID(query string) bool {
	if IsSearchID(PrefixJSONSchema, query) {
		return true
	}
	if strings.ContainsFunc(query, unicode.IsSpace) {
		return false
	}
	uri, err := url.Parse(query)
	return err == nil && uri.Scheme != "" && (uri.Host != "" || uri.Opaque != "")
}

// RankSearchText is the best match of query among values, ignoring case.
// Empty values never match.
func RankSearchText(query string, values ...string) SearchRank {
	folded := strings.ToLower(query)
	best := SearchRankNone
	for _, value := range values {
		if value == "" {
			continue
		}
		rank := SearchRankNone
		switch candidate := strings.ToLower(value); {
		case candidate == folded:
			rank = SearchRankWhole
		case strings.HasPrefix(candidate, folded):
			rank = SearchRankPrefix
		case strings.Contains(candidate, folded):
			rank = SearchRankContains
		}
		best = min(best, rank)
	}
	return best
}

// BestSearchResults keeps the limit best of one type's candidates, best
// first. The bool reports that some were left out.
func BestSearchResults(candidates []SearchResult, limit int) ([]SearchResult, bool) {
	slices.SortStableFunc(candidates, compareSearchResults)
	if len(candidates) > limit {
		return candidates[:limit], true
	}
	return candidates, false
}

// SortSearchResults orders the results of several types best match first.
// Equally good matches keep the order of types, then read by title.
func SortSearchResults(results []SearchResult, types []SearchResultType) {
	slices.SortStableFunc(results, func(a, b SearchResult) int {
		return cmp.Or(
			cmp.Compare(a.Rank, b.Rank),
			cmp.Compare(slices.Index(types, a.Type), slices.Index(types, b.Type)),
			compareSearchResults(a, b),
		)
	})
}

func compareSearchResults(a, b SearchResult) int {
	return cmp.Or(
		cmp.Compare(a.Rank, b.Rank),
		cmp.Compare(strings.ToLower(a.Title), strings.ToLower(b.Title)),
		cmp.Compare(a.ID, b.ID),
	)
}
