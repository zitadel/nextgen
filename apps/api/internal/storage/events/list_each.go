package events

import (
	"cmp"
	"context"
	"slices"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

// ListFunc is a dialect's ListEvents.
type ListFunc func(context.Context, *database.ListOptions[domain.EventField]) (*database.ListResult[*domain.Event], error)

// ListEach serves one keyset page of the events whose field is any of values:
// it reads the page of each value on its own and merges them in the page's
// order. It is how a list over several categories, or several event types,
// stays on an index.
//
// The events of one value are a range of an index that ends in
// (created_at, id), already in order, so each read stops at the page size. A
// single statement over several values has no such range: the database either
// walks every event of the project until it has a page, or collects every
// match and sorts it.
//
// opts carries the rest of the filter, the order, the limit and the cursor,
// and must not filter by field itself. The cursor is the list's own, the last
// row's (created_at, id), so a token from one call resumes every value behind
// that row, whichever value the row carried.
func ListEach(
	ctx context.Context,
	list ListFunc,
	opts *database.ListOptions[domain.EventField],
	field domain.EventField,
	values []string,
) (*database.ListResult[*domain.Event], error) {
	page := opts.Pagination
	var merged []*domain.Event
	// A value that filled its own page may hold more behind it.
	more := false
	for _, value := range unique(values) {
		sub := *opts
		sub.Filter = database.And(opts.Filter, database.Equal(database.Col(field), value))
		res, err := list(ctx, &sub)
		if err != nil {
			return nil, err
		}
		merged = append(merged, res.Items...)
		more = more || len(res.NextCursor) > 0
	}

	slices.SortFunc(merged, func(a, b *domain.Event) int {
		order := cmp.Or(a.CreatedAt.Compare(b.CreatedAt), cmp.Compare(a.ID, b.ID))
		if page.OrderBy.Direction == database.OrderDesc {
			return -order
		}
		return order
	})

	// The first rows of the merge are the page: no value holds a row that
	// belongs before the last of its own first page.
	if page.Limit != 0 && uint64(len(merged)) > uint64(page.Limit) {
		merged = merged[:page.Limit]
		more = true
	}
	result := &database.ListResult[*domain.Event]{Items: merged}
	if more && len(merged) > 0 && len(page.OrderBy.Columns) > 0 {
		last := merged[len(merged)-1]
		result.NextCursor = pagination.New(page.OrderBy, Schema.ValuesFrom(last, page.OrderBy.Columns)).Marshal()
	}
	return result, nil
}

// unique drops a value named twice, which would list its events twice.
func unique(values []string) []string {
	distinct := make([]string, 0, len(values))
	for _, value := range values {
		if !slices.Contains(distinct, value) {
			distinct = append(distinct, value)
		}
	}
	return distinct
}
