//go:build sqlite_integration

package sqlite

import (
	"context"
	"database/sql"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/events"
)

// eventQueryRecorder keeps the events query ListEvents compiles, so the test
// explains the real statement instead of a copy of it.
type eventQueryRecorder struct {
	db
	query string
	args  []any
}

func (r *eventQueryRecorder) Query(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	if strings.HasPrefix(query, eventQuery) {
		r.query, r.args = query, args
	}
	return r.db.Query(ctx, query, args...)
}

// The reads the console's Logs screen makes must each be a range of an index,
// newest first, with nothing left to sort: a page then costs its own rows,
// however many events the project holds. SQLite plans do not depend on
// statistics, so an empty database shows the production plan.
func TestListEvents_FilterPlans(t *testing.T) {
	for _, tt := range []struct {
		name   string
		filter database.Filter[domain.EventField]
		search string
	}{
		{
			name:   "unfiltered",
			search: "SEARCH events USING INDEX idx_events_project_created_at_id (project_id=?",
		},
		{
			name:   "one category",
			filter: database.Equal(database.Col(domain.EventFieldCategory), "auth"),
			search: "SEARCH events USING INDEX idx_events_project_category (project_id=? AND category=?",
		},
		{
			name:   "one request",
			filter: database.Equal(database.Col(domain.EventFieldRequestID), "req_1"),
			search: "SEARCH events USING INDEX idx_events_project_request (project_id=? AND request_id=?",
		},
		{
			name:   "one session",
			filter: database.Equal(database.Col(domain.EventFieldSessionID), "sess_1"),
			search: "SEARCH events USING INDEX idx_events_project_session (project_id=? AND session_id=?",
		},
		{
			name:   "one login flow",
			filter: database.Equal(database.Col(domain.EventFieldFlowID), "flow_1"),
			search: "SEARCH events USING INDEX idx_events_project_flow (project_id=? AND flow_id=?",
		},
		{
			name:   "one type",
			filter: database.Equal(database.Col(domain.EventFieldEventType), "user.created"),
			search: "SEARCH events USING INDEX idx_events_project_type (project_id=? AND event_type=?",
		},
		{
			name:   "one resource",
			filter: database.Equal(database.Col(domain.EventFieldEntityID), "user_2"),
			search: "SEARCH events USING INDEX idx_events_project_entity (project_id=? AND entity_id=?",
		},
		{
			// One read of the merge across categories (events.ListEach).
			name: "one actor in one category",
			filter: database.And(
				database.Equal(database.Col(domain.EventFieldActorID), "user_1"),
				database.Equal(database.Col(domain.EventFieldCategory), "admin"),
			),
			search: "SEARCH events USING INDEX idx_events_project_actor_category (project_id=? AND actor_id=? AND category=?",
		},
		{
			// A session's own events are few: its index finds them, and the
			// categories filter what it found.
			name: "one session, several categories",
			filter: database.And(
				database.Or(
					database.Equal(database.Col(domain.EventFieldCategory), "auth"),
					database.Equal(database.Col(domain.EventFieldCategory), "admin"),
				),
				database.Equal(database.Col(domain.EventFieldSessionID), "sess_1"),
			),
			search: "SEARCH events USING INDEX idx_events_project_session (project_id=? AND session_id=?",
		},
	} {
		for _, page := range []struct {
			name   string
			cursor bool
		}{{name: "first page"}, {name: "next page", cursor: true}} {
			t.Run(tt.name+", "+page.name, func(t *testing.T) {
				opts := events.ListOptions("proj-plan", 25)
				opts.Pagination.OrderBy = events.CreatedAtDesc()
				if tt.filter != nil {
					opts.Filter = database.And(opts.Filter, tt.filter)
				}
				if page.cursor {
					// The token a page ends with: the last row's (created_at, id).
					order := opts.Pagination.OrderBy
					last := &domain.Event{ID: "evt_1", CreatedAt: time.Date(2026, 11, 10, 8, 0, 0, 0, time.UTC)}
					opts.Pagination.Cursor = pagination.New(order, events.Schema.ValuesFrom(last, order.Columns)).Marshal()
				}

				rec := &eventQueryRecorder{db: db{sqlDB: testPool.sqlDB}}
				_, err := newEventStatements(rec).ListEvents(t.Context(), opts)
				require.NoError(t, err)
				require.NotEmpty(t, rec.query)

				rows, err := testPool.sqlDB.QueryContext(t.Context(), "EXPLAIN QUERY PLAN "+rec.query, rec.args...)
				require.NoError(t, err)
				defer rows.Close()
				var plan []string
				for rows.Next() {
					var id, parent, unused int
					var detail string
					require.NoError(t, rows.Scan(&id, &parent, &unused, &detail))
					plan = append(plan, detail)
				}
				require.NoError(t, rows.Err())

				require.Len(t, plan, 1, "one index range and nothing after it: %v", plan)
				assert.Contains(t, plan[0], tt.search)
				assert.NotContains(t, strings.Join(plan, "\n"), "TEMP B-TREE", "the index already holds the page's order")
			})
		}
	}
}
