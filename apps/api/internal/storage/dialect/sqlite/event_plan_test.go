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

// eventQueryRecorder keeps the events query a statement compiles, so the test
// explains the real statement instead of a copy of it.
type eventQueryRecorder struct {
	db
	// prefix is what the statement to keep starts with.
	prefix string
	query  string
	args   []any
}

func (r *eventQueryRecorder) Query(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	if strings.HasPrefix(query, r.prefix) {
		r.query, r.args = query, args
	}
	return r.db.Query(ctx, query, args...)
}

// explainEvents is SQLite's plan for the statement rec kept, a line per step.
func explainEvents(t *testing.T, rec *eventQueryRecorder) []string {
	t.Helper()
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
	return plan
}

// The ranges a list is read as (EventService.List) must each be a range of an
// index, newest first, with nothing left to sort: a page then costs its own
// rows, however many events the project holds. SQLite plans do not depend on
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
			// One read of the merge across categories (events.ListEach), as
			// for a resource and an actor.
			name: "one session in one category",
			filter: database.And(
				database.Equal(database.Col(domain.EventFieldSessionID), "sess_1"),
				database.Equal(database.Col(domain.EventFieldCategory), "auth"),
			),
			search: "SEARCH events USING INDEX idx_events_project_session_category (project_id=? AND session_id=? AND category=?",
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
			name: "one resource in one category",
			filter: database.And(
				database.Equal(database.Col(domain.EventFieldEntityID), "user_2"),
				database.Equal(database.Col(domain.EventFieldCategory), "entity"),
			),
			search: "SEARCH events USING INDEX idx_events_project_entity_category (project_id=? AND entity_id=? AND category=?",
		},
		{
			name: "one actor in one category",
			filter: database.And(
				database.Equal(database.Col(domain.EventFieldActorID), "user_1"),
				database.Equal(database.Col(domain.EventFieldCategory), "admin"),
			),
			search: "SEARCH events USING INDEX idx_events_project_actor_category (project_id=? AND actor_id=? AND category=?",
		},
		{
			name: "one resource type in one category",
			filter: database.And(
				database.Equal(database.Col(domain.EventFieldEntityType), "user"),
				database.Equal(database.Col(domain.EventFieldCategory), "auth"),
			),
			search: "SEARCH events USING INDEX idx_events_project_entity_type_category (project_id=? AND entity_type=? AND category=?",
		},
		{
			// One read of the merge across status classes, as for an
			// operation with no class named.
			name:   "one operation in one status class",
			filter: database.Equal(database.Col(domain.EventFieldOperationStatus), "createUser 5xx"),
			search: "SEARCH events USING INDEX idx_events_project_operation_status (project_id=? AND operation_status=?",
		},
		{
			name:   "one status class",
			filter: database.Equal(database.Col(domain.EventFieldStatusClass), "4xx"),
			search: "SEARCH events USING INDEX idx_events_project_status (project_id=? AND status_class=?",
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

				rec := &eventQueryRecorder{db: db{sqlDB: testPool.sqlDB}, prefix: eventQuery}
				_, err := newEventStatements(rec).ListEvents(t.Context(), opts)
				require.NoError(t, err)
				plan := explainEvents(t, rec)

				require.Len(t, plan, 1, "one index range and nothing after it: %v", plan)
				assert.Contains(t, plan[0], tt.search)
				assert.NotContains(t, strings.Join(plan, "\n"), "TEMP B-TREE", "the index already holds the page's order")
			})
		}
	}
}

// A filter no index holds is matched over a range of one that does
// (events.ScanEach). What is matched is no part of the WHERE, so it cannot
// move the read to another index: the read is the range, in order, to its
// limit, whatever is matched over it.
func TestScanEvents_Plans(t *testing.T) {
	equal := func(field domain.EventField, value string) database.Filter[domain.EventField] {
		return database.Equal(database.Col(field), value)
	}
	for _, tt := range []struct {
		name   string
		within database.Filter[domain.EventField]
		match  database.Filter[domain.EventField]
		search string
	}{
		{
			name:   "what no index holds, over the project's events",
			match:  database.And(equal(domain.EventFieldClientID, "app_1"), equal(domain.EventFieldTeamID, "team_1")),
			search: "SEARCH events USING INDEX idx_events_project_created_at_id (project_id=?",
		},
		{
			// The session and the category have indexes of their own, which
			// would each read more than the request holds.
			name:   "a session and a category, over one request",
			within: equal(domain.EventFieldRequestID, "req_1"),
			match:  database.And(equal(domain.EventFieldSessionID, "sess_1"), equal(domain.EventFieldCategory, "auth")),
			search: "SEARCH events USING INDEX idx_events_project_request (project_id=? AND request_id=?",
		},
		{
			name:   "an actor, over one resource in one category",
			within: database.And(equal(domain.EventFieldEntityID, "user_2"), equal(domain.EventFieldCategory, "entity")),
			match:  database.And(equal(domain.EventFieldActorID, "user_1")),
			search: "SEARCH events USING INDEX idx_events_project_entity_category (project_id=? AND entity_id=? AND category=?",
		},
		{
			name:   "a type and a fingerprint, over one resource type in one category",
			within: database.And(equal(domain.EventFieldEntityType, "user"), equal(domain.EventFieldCategory, "entity")),
			match:  database.And(equal(domain.EventFieldEventType, "user.created"), equal(domain.EventFieldFingerprint, "fp_1")),
			search: "SEARCH events USING INDEX idx_events_project_entity_type_category (project_id=? AND entity_type=? AND category=?",
		},
		{
			name:   "a type and a category, over one operation in one status class",
			within: equal(domain.EventFieldOperationStatus, "createUser 4xx"),
			match:  database.And(equal(domain.EventFieldEventType, "request.api"), equal(domain.EventFieldCategory, "request")),
			search: "SEARCH events USING INDEX idx_events_project_operation_status (project_id=? AND operation_status=?",
		},
		{
			name:   "an operation, over one session in one category",
			within: database.And(equal(domain.EventFieldSessionID, "sess_1"), equal(domain.EventFieldCategory, "request")),
			match:  database.And(database.Or(equal(domain.EventFieldOperationStatus, "createUser 4xx"), equal(domain.EventFieldOperationStatus, "createUser 5xx"))),
			search: "SEARCH events USING INDEX idx_events_project_session_category (project_id=? AND session_id=? AND category=?",
		},
		{
			name:   "several categories, over one type",
			within: equal(domain.EventFieldEventType, "user.created"),
			match: database.And(database.Or(
				equal(domain.EventFieldCategory, "entity"),
				equal(domain.EventFieldCategory, "admin"),
			)),
			search: "SEARCH events USING INDEX idx_events_project_type (project_id=? AND event_type=?",
		},
	} {
		for _, page := range []struct {
			name   string
			cursor bool
		}{{name: "first page"}, {name: "next page", cursor: true}} {
			t.Run(tt.name+", "+page.name, func(t *testing.T) {
				opts := events.ListOptions("proj-plan", 1000)
				opts.Pagination.OrderBy = events.CreatedAtDesc()
				if tt.within != nil {
					opts.Filter = database.And(opts.Filter, tt.within)
				}
				if page.cursor {
					order := opts.Pagination.OrderBy
					last := &domain.Event{ID: "evt_1", CreatedAt: time.Date(2026, 11, 10, 8, 0, 0, 0, time.UTC)}
					opts.Pagination.Cursor = pagination.New(order, events.Schema.ValuesFrom(last, order.Columns)).Marshal()
				}

				rec := &eventQueryRecorder{db: db{sqlDB: testPool.sqlDB}, prefix: eventScanSelect}
				_, err := newEventStatements(rec).ScanEvents(t.Context(), opts, tt.match)
				require.NoError(t, err)
				plan := explainEvents(t, rec)

				require.Len(t, plan, 1, "one index range and nothing after it: %v", plan)
				assert.Contains(t, plan[0], tt.search)
			})
		}
	}
}

// The events of a page a scan chose are loaded by id (EventService.List): a
// lookup in the primary key per event, never a walk.
func TestListEvents_ByIDsPlan(t *testing.T) {
	rec := &eventQueryRecorder{db: db{sqlDB: testPool.sqlDB}, prefix: eventQuery}
	_, err := newEventStatements(rec).ListEvents(t.Context(), &database.ListOptions[domain.EventField]{
		Filter: database.And(
			database.Equal(database.Col(domain.EventFieldProjectID), "proj-plan"),
			database.Or(
				database.Equal(database.Col(domain.EventFieldID), "evt_1"),
				database.Equal(database.Col(domain.EventFieldID), "evt_2"),
				database.Equal(database.Col(domain.EventFieldID), "evt_3"),
			),
		),
	})
	require.NoError(t, err)
	plan := explainEvents(t, rec)

	// SQLite reads an OR over one column as a list of keys to look up.
	require.Len(t, plan, 1, "a lookup in the primary key and nothing else: %v", plan)
	assert.Equal(t, "SEARCH events USING INDEX sqlite_autoindex_events_1 (project_id=? AND id=?)", plan[0])
}
