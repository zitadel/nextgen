package events

import (
	"cmp"
	"context"
	"slices"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
)

// Scanned is one event a bounded scan read: where it stands in the list's
// order, and whether it matched what the scan's index does not hold.
type Scanned struct {
	CreatedAt time.Time
	ID        string
	Matched   bool
}

// ScanFunc is a dialect's ScanEvents.
type ScanFunc func(ctx context.Context, within *database.ListOptions[domain.EventField], match database.Filter[domain.EventField]) ([]Scanned, error)

// FetchFunc loads the events with the given ids, in any order.
type FetchFunc func(ctx context.Context, ids []string) ([]*domain.Event, error)

// ScanEach serves one keyset page of a list whose filter no index holds
// whole. Part of the filter is a range of an index (opts.Filter, and one
// value of field at a time, as in ListEach). The rest, match, has to be
// tried row by row over that range, and a range can hold as many events as
// the project. So each range is read no further than budget rows: the cost of
// a call is fixed, whatever the filter and the data.
//
// The price is a short page. When a budget runs out before the page is full,
// the page holds what matched so far, possibly nothing, and the cursor is the
// last row read rather than the last row returned: the next call goes on
// from there. No cursor means every range was read to its end.
//
// With several ranges, a row may only be listed once every range has been
// read past it: a range cut short may still hold rows that belong before it.
// So the page ends at the first cut in the page's order, and what the other
// ranges read behind that is read again by the next call.
//
// budget must exceed the page's limit, or a range in which every row matches
// could not fill a page.
func ScanEach(
	ctx context.Context,
	scan ScanFunc,
	fetch FetchFunc,
	opts *database.ListOptions[domain.EventField],
	field domain.EventField,
	values []string,
	match database.Filter[domain.EventField],
	budget uint32,
) (*database.ListResult[*domain.Event], error) {
	page := opts.Pagination
	descending := page.OrderBy.Direction == database.OrderDesc
	inOrder := func(a, b Scanned) int {
		order := cmp.Or(a.CreatedAt.Compare(b.CreatedAt), cmp.Compare(a.ID, b.ID))
		if descending {
			return -order
		}
		return order
	}

	ranges := []database.Filter[domain.EventField]{opts.Filter}
	if len(values) > 0 {
		ranges = ranges[:0]
		for _, value := range unique(values) {
			ranges = append(ranges, database.And(opts.Filter, database.Equal(database.Col(field), value)))
		}
	}

	var matched []Scanned
	// The first row, in the page's order, at which a range's budget ran out.
	var cut *Scanned
	for _, within := range ranges {
		sub := *opts
		sub.Filter = within
		sub.Pagination.Limit = budget
		rows, err := scan(ctx, &sub, match)
		if err != nil {
			return nil, err
		}
		if budget != 0 && uint64(len(rows)) >= uint64(budget) {
			end := rows[len(rows)-1]
			if cut == nil || inOrder(end, *cut) < 0 {
				cut = &end
			}
		}
		for _, row := range rows {
			if row.Matched {
				matched = append(matched, row)
			}
		}
	}
	slices.SortFunc(matched, inOrder)
	if cut != nil {
		behind := slices.IndexFunc(matched, func(row Scanned) bool { return inOrder(row, *cut) > 0 })
		if behind >= 0 {
			matched = matched[:behind]
		}
	}

	// Where the next call goes on: behind the page when it is full, else
	// behind the last row every range was read to.
	next := cut
	if page.Limit != 0 && uint64(len(matched)) > uint64(page.Limit) {
		matched = matched[:page.Limit]
		next = &matched[len(matched)-1]
	}

	result := &database.ListResult[*domain.Event]{Items: []*domain.Event{}}
	if next != nil && len(page.OrderBy.Columns) > 0 {
		at := &domain.Event{CreatedAt: next.CreatedAt, ID: next.ID}
		result.NextCursor = pagination.New(page.OrderBy, Schema.ValuesFrom(at, page.OrderBy.Columns)).Marshal()
	}
	if len(matched) == 0 {
		return result, nil
	}

	ids := make([]string, len(matched))
	for i, row := range matched {
		ids[i] = row.ID
	}
	found, err := fetch(ctx, ids)
	if err != nil {
		return nil, err
	}
	byID := make(map[string]*domain.Event, len(found))
	for _, event := range found {
		byID[event.ID] = event
	}
	for _, id := range ids {
		// Retention may have purged a row between the scan and the fetch.
		if event, ok := byID[id]; ok {
			result.Items = append(result.Items, event)
		}
	}
	return result, nil
}
