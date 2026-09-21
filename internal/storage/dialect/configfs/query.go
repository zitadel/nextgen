// Package configfs stores the configuration resources the CLI authors as plain
// JSON files under a `.zitadel` directory, so an edit on disk is visible to the
// running server on the next read. Every other resource keeps its SQL dialect.
//
// The file tree is the store, not a cache of one: a read parses what is on disk
// now, and a write lands as a file. That is what makes `zitadel setup`'s output
// hot-reloadable without a restart or an upload.
package configfs

import (
	"cmp"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

// query applies a list request to items already loaded from disk.
//
// The SQL dialects push filtering, ordering and the keyset predicate into the
// database; there is no engine here to push them into, so this evaluates the
// same three things in memory against the entity itself. It reads the column
// values through the same [database.Schema] bindings the SQL dialects bind
// with, so a field is filtered and ordered by the same accessor that would
// have produced its SQL value, and the emitted cursor is byte-identical to the
// one a SQL dialect would emit for the same page.
func query[F ~uint8, T any](
	items []*T,
	opts *database.ListOptions[F],
	schema database.Schema[F, T],
) (*database.ListResult[*T], error) {
	if opts == nil {
		opts = &database.ListOptions[F]{}
	}

	matched := items
	if opts.Filter != nil {
		matched = make([]*T, 0, len(items))
		for _, item := range items {
			ok, err := matches(opts.Filter, item, schema)
			if err != nil {
				return nil, err
			}
			if ok {
				matched = append(matched, item)
			}
		}
	}

	if err := sortItems(matched, opts.Pagination.OrderBy, schema); err != nil {
		return nil, err
	}

	rest, err := afterCursor(matched, opts.Pagination, schema)
	if err != nil {
		return nil, err
	}

	page := rest
	if limit := int(opts.Pagination.Limit); limit > 0 && len(page) > limit {
		page = page[:limit]
	}

	return &database.ListResult[*T]{
		Items:      page,
		NextCursor: pagination.MarshalNext(opts.Pagination.OrderBy, page, schema, opts.Pagination.Limit),
	}, nil
}

// matches evaluates a filter tree against one entity.
//
// An unsupported filter is an error rather than a silent false: a list that
// quietly ignored a predicate would return rows the caller filtered out, and
// for an authorization predicate that is a leak, not a missing feature.
func matches[F ~uint8, T any](filter database.Filter[F], item *T, schema database.Schema[F, T]) (bool, error) {
	switch f := filter.(type) {
	case database.AndFilter[F]:
		for _, sub := range f.Filters {
			ok, err := matches(sub, item, schema)
			if err != nil || !ok {
				return false, err
			}
		}
		return true, nil

	case database.OrFilter[F]:
		for _, sub := range f.Filters {
			ok, err := matches(sub, item, schema)
			if err != nil {
				return false, err
			}
			if ok {
				return true, nil
			}
		}
		return false, nil

	case *database.CompareFilter[F]:
		return matchesCompare(f, item, schema)

	case *database.StringFilter[F]:
		return matchesString(f, item, schema)

	default:
		return false, fmt.Errorf("configfs: unsupported filter %T", filter)
	}
}

// matchesCompare evaluates a lexicographic comparison: the first term decides
// and later terms only break ties, matching [database.Compare].
func matchesCompare[F ~uint8, T any](f *database.CompareFilter[F], item *T, schema database.Schema[F, T]) (bool, error) {
	if len(f.Terms) == 0 {
		return true, nil
	}

	for i, term := range f.Terms {
		have := schema.ValuesFrom(item, []database.Column[F]{term.Column})[0]

		var (
			c   int
			err error
		)
		if f.Keyset {
			// A cursor walks a total order, so NULL has to be placed rather
			// than rejected: it sorts smallest, which is the ASC NULLS FIRST /
			// DESC NULLS LAST the dialects emit (see FieldBinding.Nullable).
			// Two NULLs tie and fall through to the next term.
			c, err = compareOrdered(have, term.Value)
		} else {
			// Ordinary SQL three-valued logic: a comparison involving NULL is
			// never true, so the row is excluded.
			if have == nil || term.Value == nil {
				return false, nil
			}
			c, err = compare(have, term.Value)
		}
		if err != nil {
			return false, err
		}

		last := i == len(f.Terms)-1
		if c != 0 || last {
			return satisfies(f.Op, c, last), nil
		}
		// Equal on a non-final term: fall through to the tie-breaker.
	}
	return false, nil
}

// satisfies reports whether a comparison result meets the operator. On a
// non-final tie-breaking term the equal case has already been consumed by the
// caller, so only the strict outcome is asked about here.
func satisfies(op database.CompareOp, c int, last bool) bool {
	switch op {
	case database.OpEqual:
		return c == 0
	case database.OpGreater:
		return c > 0
	case database.OpLess:
		return c < 0
	case database.OpGreaterOrEqual:
		if last {
			return c >= 0
		}
		return c > 0
	default:
		return false
	}
}

func matchesString[F ~uint8, T any](f *database.StringFilter[F], item *T, schema database.Schema[F, T]) (bool, error) {
	raw := schema.ValuesFrom(item, []database.Column[F]{f.Column})[0]
	if raw == nil {
		return false, nil
	}
	have, ok := raw.(string)
	if !ok {
		return false, fmt.Errorf("configfs: string filter on non-string value %T", raw)
	}
	want := f.Value
	if f.IgnoreCase {
		have, want = strings.ToLower(have), strings.ToLower(want)
	}
	switch f.Match {
	case database.StringMatchEqual:
		return have == want, nil
	case database.StringMatchStartsWith:
		return strings.HasPrefix(have, want), nil
	case database.StringMatchContains:
		return strings.Contains(have, want), nil
	case database.StringMatchEndsWith:
		return strings.HasSuffix(have, want), nil
	default:
		return false, fmt.Errorf("configfs: unsupported string match %d", f.Match)
	}
}

// sortItems orders items by the requested columns. NULL sorts smallest, so
// ascending puts it first and descending puts it last, matching the
// ASC NULLS FIRST / DESC NULLS LAST the SQL dialects emit.
func sortItems[F ~uint8, T any](items []*T, orderBy database.OrderBy[F], schema database.Schema[F, T]) error {
	if len(orderBy.Columns) == 0 {
		return nil
	}
	var sortErr error
	slices.SortStableFunc(items, func(a, b *T) int {
		if sortErr != nil {
			return 0
		}
		for _, col := range orderBy.Columns {
			av := schema.ValuesFrom(a, []database.Column[F]{col})[0]
			bv := schema.ValuesFrom(b, []database.Column[F]{col})[0]
			c, err := compareOrdered(av, bv)
			if err != nil {
				sortErr = err
				return 0
			}
			if c == 0 {
				continue
			}
			if orderBy.Direction == database.OrderDesc {
				return -c
			}
			return c
		}
		return 0
	})
	return sortErr
}

// compareOrdered is compare extended to a total order over NULL, which sorts
// smaller than every value. Two NULLs are equal.
func compareOrdered(a, b any) (int, error) {
	switch {
	case a == nil && b == nil:
		return 0, nil
	case a == nil:
		return -1, nil
	case b == nil:
		return 1, nil
	}
	return compare(a, b)
}

// afterCursor drops the items a page token has already returned. The token is
// decoded with the shared cursor codec, so a token minted by a SQL dialect
// stays valid if a deployment switches stores.
func afterCursor[F ~uint8, T any](
	items []*T,
	page database.Page[F],
	schema database.Schema[F, T],
) ([]*T, error) {
	if len(page.Cursor) == 0 {
		return items, nil
	}
	cursor, err := pagination.CursorFromToken[F](page.Cursor)
	if err != nil {
		return nil, database.ErrInvalidCursor()
	}
	if !cursor.MatchesOrderBy(page.OrderBy) {
		// A token from a different sort is not a page of this list.
		return nil, database.ErrInvalidCursor()
	}
	values, err := schema.CoerceCursorValues(cursor.Columns, cursor.Values)
	if err != nil {
		return nil, err
	}

	op := database.OpGreater
	if page.OrderBy.Direction == database.OrderDesc {
		op = database.OpLess
	}
	terms := make([]database.CompareTerm[F], len(cursor.Columns))
	for i, col := range cursor.Columns {
		terms[i] = database.Term(col, values[i])
	}
	keyset := database.Compare(op, terms...)
	keyset.Keyset = true

	rest := make([]*T, 0, len(items))
	for _, item := range items {
		ok, err := matchesCompare(keyset, item, schema)
		if err != nil {
			return nil, err
		}
		if ok {
			rest = append(rest, item)
		}
	}
	return rest, nil
}

// compare orders two bound values of the same column. The set of types is
// closed by the FieldBinding accessors the config kinds declare.
func compare(a, b any) (int, error) {
	switch av := a.(type) {
	case string:
		bv, err := asString(b)
		if err != nil {
			return 0, err
		}
		return cmp.Compare(av, bv), nil
	case time.Time:
		bv, ok := b.(time.Time)
		if !ok {
			return 0, fmt.Errorf("configfs: cannot compare time with %T", b)
		}
		return av.Compare(bv), nil
	case bool:
		bv, ok := b.(bool)
		if !ok {
			return 0, fmt.Errorf("configfs: cannot compare bool with %T", b)
		}
		switch {
		case av == bv:
			return 0, nil
		case av:
			return 1, nil
		default:
			return -1, nil
		}
	default:
		ai, aok := asInt64(a)
		bi, bok := asInt64(b)
		if aok && bok {
			return cmp.Compare(ai, bi), nil
		}
		return 0, fmt.Errorf("configfs: cannot compare %T with %T", a, b)
	}
}

// asString accepts the stringer-backed enums the config kinds bind as text.
func asString(v any) (string, error) {
	switch s := v.(type) {
	case string:
		return s, nil
	case fmt.Stringer:
		return s.String(), nil
	default:
		return "", fmt.Errorf("configfs: cannot compare string with %T", v)
	}
}

func asInt64(v any) (int64, bool) {
	switch n := v.(type) {
	case int:
		return int64(n), true
	case int8:
		return int64(n), true
	case int16:
		return int64(n), true
	case int32:
		return int64(n), true
	case int64:
		return n, true
	case uint8:
		return int64(n), true
	case uint16:
		return int64(n), true
	case uint32:
		return int64(n), true
	case uint64:
		return int64(n), true
	default:
		return 0, false
	}
}
