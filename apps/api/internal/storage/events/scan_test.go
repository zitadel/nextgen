package events_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/events"
)

// A range's rows as a scan returns them, newest first: second n is row n.
func scanned(matched map[int]bool, seconds ...int) []events.Scanned {
	at := time.Date(2026, 11, 10, 8, 0, 0, 0, time.UTC)
	rows := make([]events.Scanned, len(seconds))
	for i, second := range seconds {
		rows[i] = events.Scanned{
			CreatedAt: at.Add(time.Duration(second) * time.Second),
			ID:        "evt_" + string(rune('0'+second)),
			Matched:   matched[second],
		}
	}
	return rows
}

// The token a page ends with when it goes on behind row second.
func tokenAt(second int) []byte {
	row := scanned(nil, second)[0]
	order := events.CreatedAtDesc()
	at := &domain.Event{CreatedAt: row.CreatedAt, ID: row.ID}
	return pagination.New(order, events.Schema.ValuesFrom(at, order.Columns)).Marshal()
}

func fetchAll(_ context.Context, ids []string) ([]*domain.Event, error) {
	found := make([]*domain.Event, len(ids))
	// In another order than asked: the page's order is the scan's.
	for i, id := range ids {
		found[len(ids)-1-i] = &domain.Event{ID: id}
	}
	return found, nil
}

func scanIDs(items []*domain.Event) []string {
	ids := make([]string, len(items))
	for i, item := range items {
		ids[i] = item.ID
	}
	return ids
}

func TestScanEach(t *testing.T) {
	const budget = 4
	category := func(value string) database.Filter[domain.EventField] {
		return database.And(
			database.Equal(database.Col(domain.EventFieldProjectID), "proj_1"),
			database.Equal(database.Col(domain.EventFieldCategory), value),
		)
	}

	for name, tc := range map[string]struct {
		// What each range holds behind the cursor, newest first.
		ranges map[string][]events.Scanned
		values []string
		limit  uint32
		want   []string
		// The row the next call goes on behind; 0 for a list that is complete.
		next int
	}{
		"a range read to its end is complete, whatever matched": {
			ranges: map[string][]events.Scanned{"": scanned(map[int]bool{7: true, 5: true}, 7, 6, 5)},
			limit:  2,
			want:   []string{"evt_7", "evt_5"},
		},
		"a full page goes on behind its last row": {
			ranges: map[string][]events.Scanned{"": scanned(map[int]bool{9: true, 8: true, 7: true}, 9, 8, 7)},
			limit:  2,
			want:   []string{"evt_9", "evt_8"},
			next:   8,
		},
		"a budget that runs out leaves a short page, and goes on behind the last row read": {
			ranges: map[string][]events.Scanned{"": scanned(map[int]bool{8: true}, 9, 8, 7, 6)},
			limit:  2,
			want:   []string{"evt_8"},
			next:   6,
		},
		"a budget that runs out on nothing leaves an empty page that still goes on": {
			ranges: map[string][]events.Scanned{"": scanned(nil, 9, 8, 7, 6)},
			limit:  2,
			want:   []string{},
			next:   6,
		},
		"a row behind another range's cut waits for the next call": {
			ranges: map[string][]events.Scanned{
				// Cut at 6: it may hold more between 6 and 3.
				"auth":   scanned(map[int]bool{9: true}, 9, 8, 7, 6),
				"entity": scanned(map[int]bool{5: true, 3: true}, 5, 3),
			},
			values: []string{"auth", "entity"},
			limit:  3,
			want:   []string{"evt_9"},
			next:   6,
		},
		"of two cuts the page ends at the first": {
			ranges: map[string][]events.Scanned{
				"auth":   scanned(map[int]bool{9: true, 2: true}, 9, 4, 3, 2),
				"entity": scanned(map[int]bool{8: true, 6: true}, 8, 7, 6, 5),
			},
			values: []string{"auth", "entity"},
			limit:  3,
			want:   []string{"evt_9", "evt_8", "evt_6"},
			next:   5,
		},
		"a value named twice is read once": {
			ranges: map[string][]events.Scanned{"auth": scanned(map[int]bool{9: true}, 9, 8)},
			values: []string{"auth", "auth"},
			limit:  3,
			want:   []string{"evt_9"},
		},
	} {
		t.Run(name, func(t *testing.T) {
			match := database.Equal(database.Col(domain.EventFieldClientID), "app_1")
			asked := map[string]int{}
			scan := func(_ context.Context, within *database.ListOptions[domain.EventField], got database.Filter[domain.EventField]) ([]events.Scanned, error) {
				assert.Equal(t, match, got)
				assert.Equal(t, uint32(budget), within.Pagination.Limit, "each range is read as far as the budget, not the page")
				for value, rows := range tc.ranges {
					if value == "" || assert.ObjectsAreEqual(category(value), within.Filter) {
						asked[value]++
						return rows, nil
					}
				}
				t.Fatalf("an unexpected range: %#v", within.Filter)
				return nil, nil
			}

			opts := events.ListOptions("proj_1", tc.limit)
			opts.Pagination.OrderBy = events.CreatedAtDesc()
			page, err := events.ScanEach(t.Context(), scan, fetchAll, opts, domain.EventFieldCategory, tc.values, match, budget)
			require.NoError(t, err)

			assert.Equal(t, tc.want, scanIDs(page.Items))
			if tc.next == 0 {
				assert.Empty(t, page.NextCursor)
			} else {
				assert.Equal(t, string(tokenAt(tc.next)), string(page.NextCursor))
			}
			for value := range tc.ranges {
				assert.Equal(t, 1, asked[value], "range %q", value)
			}
		})
	}
}

// Retention can purge an event between the scan that found it and the fetch.
func TestScanEach_skipsARowThatIsGone(t *testing.T) {
	scan := func(context.Context, *database.ListOptions[domain.EventField], database.Filter[domain.EventField]) ([]events.Scanned, error) {
		return scanned(map[int]bool{9: true, 8: true}, 9, 8), nil
	}
	fetch := func(context.Context, []string) ([]*domain.Event, error) {
		return []*domain.Event{{ID: "evt_8"}}, nil
	}
	opts := events.ListOptions("proj_1", 5)
	opts.Pagination.OrderBy = events.CreatedAtDesc()
	page, err := events.ScanEach(t.Context(), scan, fetch, opts, domain.EventFieldCategory, nil,
		database.Equal(database.Col(domain.EventFieldClientID), "app_1"), 10)
	require.NoError(t, err)
	assert.Equal(t, []string{"evt_8"}, scanIDs(page.Items))
}
