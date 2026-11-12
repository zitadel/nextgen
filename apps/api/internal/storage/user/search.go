package user

import (
	"cmp"
	"slices"
	"unicode"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

// A search read joins the matching attribute rows to the users under these
// column names. They differ from every users column, so a filter, the cursor
// and the order can name columns of either side unqualified.
const (
	SearchProjectIDColumn = "ua_project_id"
	SearchUserIDColumn    = "ua_user_id"
	SearchTextColumn      = "ua_search_text"
)

// SearchOrder is the one order a search read returns: the matched text, then
// the user's id, both ascending. It is the order of the search index, so the
// database reads a page from the index and stops, however many users match.
func SearchOrder() database.OrderBy[domain.UserField] {
	return database.OrderBy[domain.UserField]{
		Columns: []database.Column[domain.UserField]{
			database.Col(domain.UserFieldSearchText),
			database.Col(domain.UserFieldSearchUserID),
		},
		Direction: database.OrderAsc,
	}
}

// ListOptions returns the options a user read runs with. A search read always
// takes [SearchOrder], whatever opts asks for; any other read takes the default
// of [EnsureListOptions] and may not order by a search field, which names a
// column only a search read has.
func ListOptions(opts *database.ListOptions[domain.UserField], searching bool) (*database.ListOptions[domain.UserField], error) {
	out := EnsureListOptions(opts)
	if searching {
		out.Pagination.OrderBy = SearchOrder()
		return out, nil
	}
	for _, column := range out.Pagination.OrderBy.Columns {
		if field := column.Field(); field == domain.UserFieldSearchText || field == domain.UserFieldSearchUserID {
			return nil, database.ErrFieldNotOrderable(field)
		}
	}
	return out, nil
}

// SearchBounds is the range of search texts that start with prefix: from lower
// up to, not including, upper. The texts compare by code point on every
// dialect, so the range is one stretch of the search index. Unbounded says
// there is no upper end, which only a prefix of the highest code point has.
func SearchBounds(prefix string) (lower, upper string, bounded bool) {
	runes := []rune(prefix)
	for i := len(runes) - 1; i >= 0; i-- {
		next := runes[i] + 1
		if next == surrogateMin {
			// No string holds a surrogate, and no database accepts one.
			next = surrogateMax + 1
		}
		if next <= unicode.MaxRune {
			return prefix, string(runes[:i]) + string(next), true
		}
	}
	return prefix, "", false
}

const (
	surrogateMin = 0xD800
	surrogateMax = 0xDFFF
)

// SearchLower moves the lower bound of a search up to the text the page token
// stopped at. The keyset comparison alone resumes the page correctly, but as a
// filter: a dialect that cannot seek on it would read every match of the
// earlier pages again.
func SearchLower(lower string, page database.Page[domain.UserField]) (string, error) {
	if len(page.Cursor) == 0 {
		return lower, nil
	}
	cursor, err := pagination.CursorFromToken[domain.UserField](page.Cursor)
	if err != nil || len(cursor.Values) == 0 {
		return "", database.ErrInvalidCursor()
	}
	text, ok := cursor.Values[0].(string)
	if !ok {
		return "", database.ErrInvalidCursor()
	}
	return max(lower, text), nil
}

// MergeSearchPages merges the pages a search read fetched per attribute key
// into one page in [SearchOrder], at most limit users long; limit 0 keeps all.
// Each page is already in that order and at most limit long, so the first
// limit users of the merge are the first limit users of the whole search.
func MergeSearchPages(pages [][]*domain.User, limit uint32) []*domain.User {
	if len(pages) == 1 {
		return pages[0]
	}
	merged := slices.Concat(pages...)
	slices.SortStableFunc(merged, func(a, b *domain.User) int {
		return cmp.Or(cmp.Compare(a.MatchedText, b.MatchedText), cmp.Compare(a.ID, b.ID))
	})
	if limit != 0 && uint64(len(merged)) > uint64(limit) {
		merged = merged[:limit]
	}
	return merged
}

// SearchIndexArm names one range of a user search across projects by what its
// rows carry.
type SearchIndexArm struct {
	ProjectID string
	Key       domain.AttributeKey
}

// SearchIndexArms indexes ranges by the project and property each reads.
func SearchIndexArms(ranges []domain.UserSearchRange) map[SearchIndexArm]int {
	arms := make(map[SearchIndexArm]int, len(ranges))
	for i, r := range ranges {
		arms[SearchIndexArm{ProjectID: r.ProjectID, Key: r.Key}] = i
	}
	return arms
}

// MarkSearchIndexFull sets Full on each range that read limit rows.
func MarkSearchIndexFull(ranges []domain.UserSearchRange, limit int) []domain.UserSearchRange {
	for i := range ranges {
		ranges[i].Full = limit > 0 && len(ranges[i].Hits) == limit
	}
	return ranges
}
