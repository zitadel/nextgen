//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/dialect/pagination"
	"github.com/zitadel/nextgen/internal/storage/events"
)

func uniqueEventIDs(t *testing.T) (projectID, eventID string) {
	t.Helper()
	suffix := uniqueSuffix(t)
	return "proj-evt-" + suffix, "evt-" + suffix
}

func ensureEventProject(t *testing.T, stmts service.AllStatements, projectID string) {
	t.Helper()
	project := newTestProject(projectID)
	require.NoError(t, stmts.CreateProject(t.Context(), project))
	t.Cleanup(func() { _, _ = stmts.DeleteProjectByID(context.Background(), projectID) })
}

func sampleEvent(projectID, id string) *domain.Event {
	actor := "user_sample"
	actorType := domain.EventActorTypeHuman
	entityType := "user"
	entityID := "user_sample"
	payload, _ := json.Marshal(domain.UserCreatedPayload{SchemaID: "sch_default", AttributeKeys: []string{"email"}})
	return &domain.Event{
		ProjectID:  projectID,
		ID:         id,
		EventType:  domain.EventTypeUserCreated,
		Category:   domain.EventCategoryEntity,
		ActorID:    &actor,
		ActorType:  &actorType,
		EntityType: &entityType,
		EntityID:   &entityID,
		ClientID:   "app_test",
		Payload:    payload,
		Metadata:   json.RawMessage(`{}`),
	}
}

func TestEventStatements_InsertAndGet(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, eventID := uniqueEventIDs(t)
		ensureEventProject(t, d.stmts, projectID)

		entity := sampleEvent(projectID, eventID)
		require.NoError(t, d.stmts.InsertEvent(t.Context(), entity))
		assert.False(t, entity.CreatedAt.IsZero())
		assert.False(t, entity.OccurredAt.IsZero())
		assert.WithinDuration(t, time.Now(), entity.CreatedAt, 5*time.Second)
		assert.WithinDuration(t, entity.CreatedAt, entity.OccurredAt, time.Second)

		got, err := d.stmts.GetEventByID(t.Context(), projectID, eventID)
		require.NoError(t, err)
		assert.Equal(t, entity.ProjectID, got.ProjectID)
		assert.Equal(t, entity.ID, got.ID)
		assert.Equal(t, entity.EventType, got.EventType)
		assert.Equal(t, entity.Category, got.Category)
		assert.Equal(t, entity.ClientID, got.ClientID)
		require.NotNil(t, got.ActorID)
		assert.Equal(t, *entity.ActorID, *got.ActorID)
		assert.JSONEq(t, string(entity.Payload), string(got.Payload))
		assert.Nil(t, got.OperationID, "only a request event names an operation")
		assert.Nil(t, got.StatusClass)
	})
}

// A request event's operation and status class are columns of their own,
// read back as written.
func TestEventStatements_InsertAndGet_RequestColumns(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, eventID := uniqueEventIDs(t)
		ensureEventProject(t, d.stmts, projectID)

		recorded := domain.RequestAPIPayload{OperationID: "createUser", Method: "POST", RouteTemplate: "createUser", Status: 409}
		payload, err := json.Marshal(recorded)
		require.NoError(t, err)
		entity := &domain.Event{
			ProjectID: projectID,
			ID:        eventID,
			EventType: domain.EventTypeRequestAPI,
			Category:  domain.EventCategoryRequest,
			Payload:   payload,
		}
		entity.OperationID, entity.StatusClass = recorded.Indexed()
		require.NoError(t, d.stmts.InsertEvent(t.Context(), entity))

		got, err := d.stmts.GetEventByID(t.Context(), projectID, eventID)
		require.NoError(t, err)
		require.NotNil(t, got.OperationID)
		assert.Equal(t, "createUser", *got.OperationID)
		require.NotNil(t, got.StatusClass)
		assert.Equal(t, domain.HTTPStatusClassClientError, *got.StatusClass)
	})
}

func TestEventStatements_Insert_EmptyIDAssigned(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, _ := uniqueEventIDs(t)
		ensureEventProject(t, d.stmts, projectID)

		entity := sampleEvent(projectID, "")
		require.NoError(t, d.stmts.InsertEvent(t.Context(), entity))
		require.NotEmpty(t, entity.ID)
		assert.True(t, strings.HasPrefix(entity.ID, string(domain.PrefixEvent)+"_"))

		got, err := d.stmts.GetEventByID(t.Context(), projectID, entity.ID)
		require.NoError(t, err)
		assert.Equal(t, entity.ID, got.ID)
	})
}

func TestEventStatements_Insert_OccurredAtWait(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, _ := uniqueEventIDs(t)
		ensureEventProject(t, d.stmts, projectID)

		entity := sampleEvent(projectID, "")
		entity.OccurredAtWait = 250 * time.Millisecond
		require.NoError(t, d.stmts.InsertEvent(t.Context(), entity))
		assert.True(t, entity.CreatedAt.After(entity.OccurredAt) || entity.CreatedAt.Equal(entity.OccurredAt.Add(200*time.Millisecond)))
		delta := entity.CreatedAt.Sub(entity.OccurredAt)
		assert.GreaterOrEqual(t, delta, 200*time.Millisecond)
		assert.LessOrEqual(t, delta, time.Second)
	})
}

func TestEventStatements_ListKeyset(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, _ := uniqueEventIDs(t)
		ensureEventProject(t, d.stmts, projectID)

		first := sampleEvent(projectID, "evt-001")
		require.NoError(t, d.stmts.InsertEvent(t.Context(), first))
		second := sampleEvent(projectID, "evt-002")
		second.EventType = domain.EventTypeUserDeleted
		require.NoError(t, d.stmts.InsertEvent(t.Context(), second))

		page1, err := d.stmts.ListEvents(t.Context(), events.ListOptions(projectID, 1))
		require.NoError(t, err)
		require.Len(t, page1.Items, 1)
		assert.Equal(t, "evt-001", page1.Items[0].ID)
		require.NotEmpty(t, page1.NextCursor)

		opts := events.ListOptions(projectID, 1)
		opts.Pagination.Cursor = page1.NextCursor
		page2, err := d.stmts.ListEvents(t.Context(), opts)
		require.NoError(t, err)
		require.Len(t, page2.Items, 1)
		assert.Equal(t, "evt-002", page2.Items[0].ID)
	})
}

func TestEventStatements_ListKeyset_Desc(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, _ := uniqueEventIDs(t)
		ensureEventProject(t, d.stmts, projectID)

		first := sampleEvent(projectID, "evt-001")
		require.NoError(t, d.stmts.InsertEvent(t.Context(), first))
		second := sampleEvent(projectID, "evt-002")
		second.EventType = domain.EventTypeUserDeleted
		require.NoError(t, d.stmts.InsertEvent(t.Context(), second))

		descOpts := func() *database.ListOptions[domain.EventField] {
			opts := events.ListOptions(projectID, 1)
			opts.Pagination.OrderBy = events.CreatedAtDesc()
			return opts
		}

		page1, err := d.stmts.ListEvents(t.Context(), descOpts())
		require.NoError(t, err)
		require.Len(t, page1.Items, 1)
		assert.Equal(t, "evt-002", page1.Items[0].ID, "descending keyset serves the newest event first")
		require.NotEmpty(t, page1.NextCursor)

		opts := descOpts()
		opts.Pagination.Cursor = page1.NextCursor
		page2, err := d.stmts.ListEvents(t.Context(), opts)
		require.NoError(t, err)
		require.Len(t, page2.Items, 1)
		assert.Equal(t, "evt-001", page2.Items[0].ID, "the descending cursor pages back through older events")
	})
}

// The reads the events indexes serve (migrations events_filter_indexes,
// events_value_indexes and events_request_indexes): by category, type, actor,
// resource and resource type, by operation and status class, and the events
// of one request, session or login flow. Each returns exactly its rows.
func TestEventStatements_ListByIndexedFilters(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, _ := uniqueEventIDs(t)
		ensureEventProject(t, d.stmts, projectID)

		request, session, flow := "req_1", "sess_1", "flow_1"
		alice, service, resource := "user_alice", "svc_backend", "user_bob"
		createUser, getMyUser := "createUser", "getMyUser"
		ok, failed := domain.HTTPStatusClassSuccessful, domain.HTTPStatusClassClientError
		for _, seed := range []struct {
			id          string
			eventType   domain.EventType
			category    domain.EventCategory
			actor       *string
			entity      *string
			request     *string
			session     *string
			flow        *string
			operation   *string
			statusClass *domain.HTTPStatusClass
		}{
			{id: "evt-001", eventType: domain.EventTypeRequestAPI, category: domain.EventCategoryRequest, actor: &alice, request: &request, session: &session, operation: &createUser, statusClass: &ok},
			{id: "evt-002", eventType: domain.EventTypeUserCreated, category: domain.EventCategoryEntity, actor: &alice, entity: &resource, request: &request},
			{id: "evt-003", eventType: domain.EventTypeAuthCheckSucceeded, category: domain.EventCategoryAuth, session: &session, flow: &flow},
			{id: "evt-004", eventType: domain.EventTypeAuthCheckSucceeded, category: domain.EventCategoryAuth, actor: &service},
			{id: "evt-005", eventType: domain.EventTypeUserDeleted, category: domain.EventCategoryEntity, actor: &service, entity: &resource},
			{id: "evt-006", eventType: domain.EventTypeRequestAPI, category: domain.EventCategoryRequest, actor: &service, operation: &createUser, statusClass: &failed},
			{id: "evt-007", eventType: domain.EventTypeRequestAPI, category: domain.EventCategoryRequest, actor: &service, operation: &getMyUser, statusClass: &failed},
			{id: "evt-008", eventType: domain.EventTypeRequestAPI, category: domain.EventCategoryRequest, statusClass: &failed},
		} {
			event := sampleEvent(projectID, seed.id)
			event.EventType, event.Category = seed.eventType, seed.category
			event.ActorID, event.EntityID = seed.actor, seed.entity
			if seed.category == domain.EventCategoryRequest {
				event.EntityType = nil
			}
			event.RequestID, event.SessionID, event.FlowID = seed.request, seed.session, seed.flow
			event.OperationID, event.StatusClass = seed.operation, seed.statusClass
			require.NoError(t, d.stmts.InsertEvent(t.Context(), event))
		}

		equal := func(field domain.EventField, value string) database.Filter[domain.EventField] {
			return database.Equal(database.Col(field), value)
		}
		for name, tc := range map[string]struct {
			filter database.Filter[domain.EventField]
			want   []string
		}{
			"category": {filter: equal(domain.EventFieldCategory, string(domain.EventCategoryAuth)), want: []string{"evt-004", "evt-003"}},
			"request":  {filter: equal(domain.EventFieldRequestID, request), want: []string{"evt-002", "evt-001"}},
			"session":  {filter: equal(domain.EventFieldSessionID, session), want: []string{"evt-003", "evt-001"}},
			"flow":     {filter: equal(domain.EventFieldFlowID, flow), want: []string{"evt-003"}},
			"type":     {filter: equal(domain.EventFieldEventType, string(domain.EventTypeAuthCheckSucceeded)), want: []string{"evt-004", "evt-003"}},
			"resource": {filter: equal(domain.EventFieldEntityID, resource), want: []string{"evt-005", "evt-002"}},
			"actor in one category": {
				filter: database.And(equal(domain.EventFieldActorID, alice), equal(domain.EventFieldCategory, string(domain.EventCategoryEntity))),
				want:   []string{"evt-002"},
			},
			"resource type in one category": {
				filter: database.And(equal(domain.EventFieldEntityType, "user"), equal(domain.EventFieldCategory, string(domain.EventCategoryAuth))),
				want:   []string{"evt-004", "evt-003"},
			},
			"operation in one status class": {
				filter: equal(domain.EventFieldOperationStatus, events.OperationStatus(createUser, failed)),
				want:   []string{"evt-006"},
			},
			"status class": {filter: equal(domain.EventFieldStatusClass, string(failed)), want: []string{"evt-008", "evt-007", "evt-006"}},
		} {
			t.Run(name, func(t *testing.T) {
				opts := events.ListOptions(projectID, 10)
				opts.Pagination.OrderBy = events.CreatedAtDesc()
				opts.Filter = database.And(opts.Filter, tc.filter)
				page, err := d.stmts.ListEvents(t.Context(), opts)
				require.NoError(t, err)
				assert.Equal(t, tc.want, eventIDs(page.Items))
				assert.Empty(t, page.NextCursor)
			})
		}

		// One actor across every category, and several types: a read per
		// value, merged newest first (events.ListEach).
		t.Run("actor across categories", func(t *testing.T) {
			opts := events.ListOptions(projectID, 10)
			opts.Pagination.OrderBy = events.CreatedAtDesc()
			opts.Filter = database.And(opts.Filter, equal(domain.EventFieldActorID, alice))
			categories := make([]string, 0, len(domain.EventCategories()))
			for _, category := range domain.EventCategories() {
				categories = append(categories, string(category))
			}
			page, err := events.ListEach(t.Context(), d.stmts.ListEvents, opts, domain.EventFieldCategory, categories)
			require.NoError(t, err)
			assert.Equal(t, []string{"evt-002", "evt-001"}, eventIDs(page.Items))
		})
		// One operation across every status class: a read per class, merged.
		t.Run("operation across status classes", func(t *testing.T) {
			opts := events.ListOptions(projectID, 10)
			opts.Pagination.OrderBy = events.CreatedAtDesc()
			keys := make([]string, 0, len(domain.HTTPStatusClasses()))
			for _, class := range domain.HTTPStatusClasses() {
				keys = append(keys, events.OperationStatus(createUser, class))
			}
			page, err := events.ListEach(t.Context(), d.stmts.ListEvents, opts, domain.EventFieldOperationStatus, keys)
			require.NoError(t, err)
			assert.Equal(t, []string{"evt-006", "evt-001"}, eventIDs(page.Items))
		})
		t.Run("several types", func(t *testing.T) {
			opts := events.ListOptions(projectID, 2)
			opts.Pagination.OrderBy = events.CreatedAtDesc()
			types := []string{string(domain.EventTypeUserCreated), string(domain.EventTypeUserDeleted), string(domain.EventTypeAuthCheckSucceeded)}
			page, err := events.ListEach(t.Context(), d.stmts.ListEvents, opts, domain.EventFieldEventType, types)
			require.NoError(t, err)
			assert.Equal(t, []string{"evt-005", "evt-004"}, eventIDs(page.Items))
			require.NotEmpty(t, page.NextCursor)

			opts.Pagination.Cursor = page.NextCursor
			rest, err := events.ListEach(t.Context(), d.stmts.ListEvents, opts, domain.EventFieldEventType, types)
			require.NoError(t, err)
			assert.Equal(t, []string{"evt-003", "evt-002"}, eventIDs(rest.Items))
			assert.Empty(t, rest.NextCursor)
		})
	})
}

// Several categories are read one at a time and merged
// (events.ListEach). The pages must be the ones a single ordered read
// of those categories would serve: every event once, in order, whichever
// category the page's last row was in.
func TestEventStatements_ListEach(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, _ := uniqueEventIDs(t)
		ensureEventProject(t, d.stmts, projectID)

		// Interleaved in time, with a run of one category longer than a page
		// and a category that is not asked for.
		for i, category := range []domain.EventCategory{
			domain.EventCategoryAuth,
			domain.EventCategoryRequest,
			domain.EventCategoryEntity,
			domain.EventCategoryAuth,
			domain.EventCategoryAuth,
			domain.EventCategoryAuth,
			domain.EventCategoryRequest,
			domain.EventCategoryAdmin,
			domain.EventCategoryEntity,
		} {
			event := sampleEvent(projectID, "evt-00"+string(rune('1'+i)))
			event.Category = category
			require.NoError(t, d.stmts.InsertEvent(t.Context(), event))
		}
		oldestFirst := []string{"evt-001", "evt-003", "evt-004", "evt-005", "evt-006", "evt-008", "evt-009"}
		newestFirst := slices.Clone(oldestFirst)
		slices.Reverse(newestFirst)
		// One named twice lists its events once.
		categories := []string{"auth", "entity", "admin", "signal", "auth"}

		for name, tc := range map[string]struct {
			order database.OrderBy[domain.EventField]
			want  []string
		}{
			"newest first": {order: events.CreatedAtDesc(), want: newestFirst},
			"oldest first": {order: events.CreatedAtAsc(), want: oldestFirst},
		} {
			t.Run(name, func(t *testing.T) {
				var got []string
				var cursor []byte
				for pages := 0; ; pages++ {
					require.Less(t, pages, len(tc.want)+1, "the list must end")
					opts := events.ListOptions(projectID, 2)
					opts.Pagination.OrderBy = tc.order
					opts.Pagination.Cursor = cursor
					page, err := events.ListEach(t.Context(), d.stmts.ListEvents, opts, domain.EventFieldCategory, categories)
					require.NoError(t, err)
					require.LessOrEqual(t, len(page.Items), 2)
					got = append(got, eventIDs(page.Items)...)
					if len(page.NextCursor) == 0 {
						break
					}
					cursor = page.NextCursor
				}
				assert.Equal(t, tc.want, got)
			})
		}

		t.Run("no token after a page that ends the list", func(t *testing.T) {
			opts := events.ListOptions(projectID, uint32(len(oldestFirst)))
			page, err := events.ListEach(t.Context(), d.stmts.ListEvents, opts, domain.EventFieldCategory, categories)
			require.NoError(t, err)
			assert.Equal(t, oldestFirst, eventIDs(page.Items))
			assert.Empty(t, page.NextCursor)
		})
	})
}

// A bounded scan reads one index range in order, to its limit, and says of
// each row whether it satisfies what the range does not hold. A row that
// carries no value for a matched column does not match it.
func TestEventStatements_Scan(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, _ := uniqueEventIDs(t)
		ensureEventProject(t, d.stmts, projectID)

		alice := "user_alice"
		for i, seed := range []struct {
			category domain.EventCategory
			actor    *string
			client   string
		}{
			{category: domain.EventCategoryAuth, actor: &alice, client: "app_1"},
			{category: domain.EventCategoryRequest, actor: &alice, client: "app_1"},
			{category: domain.EventCategoryAuth, client: "app_1"},
			{category: domain.EventCategoryAuth, actor: &alice, client: "app_2"},
			{category: domain.EventCategoryAuth, actor: &alice, client: "app_1"},
		} {
			event := sampleEvent(projectID, "evt-00"+string(rune('1'+i)))
			event.Category, event.ActorID, event.ClientID = seed.category, seed.actor, seed.client
			require.NoError(t, d.stmts.InsertEvent(t.Context(), event))
		}

		type row struct {
			id      string
			matched bool
		}
		read := func(t *testing.T, opts *database.ListOptions[domain.EventField], match database.Filter[domain.EventField]) []row {
			t.Helper()
			scanned, err := d.stmts.ScanEvents(t.Context(), opts, match)
			require.NoError(t, err)
			rows := make([]row, len(scanned))
			for i, s := range scanned {
				assert.False(t, s.CreatedAt.IsZero())
				rows[i] = row{id: s.ID, matched: s.Matched}
			}
			return rows
		}
		auth := func(limit uint32) *database.ListOptions[domain.EventField] {
			opts := events.ListOptions(projectID, limit)
			opts.Pagination.OrderBy = events.CreatedAtDesc()
			opts.Filter = database.And(opts.Filter, database.Equal(database.Col(domain.EventFieldCategory), string(domain.EventCategoryAuth)))
			return opts
		}
		match := database.And(
			database.Equal(database.Col(domain.EventFieldActorID), alice),
			database.Equal(database.Col(domain.EventFieldClientID), "app_1"),
		)

		t.Run("every row of the range, with whether it matched", func(t *testing.T) {
			assert.Equal(t, []row{
				{"evt-005", true},
				{"evt-004", false}, // another application
				{"evt-003", false}, // no actor
				{"evt-001", true},
			}, read(t, auth(10), match))
		})
		t.Run("no further than the limit", func(t *testing.T) {
			assert.Equal(t, []row{{"evt-005", true}, {"evt-004", false}}, read(t, auth(2), match))
		})
		t.Run("behind the cursor", func(t *testing.T) {
			first, err := d.stmts.ScanEvents(t.Context(), auth(2), match)
			require.NoError(t, err)
			opts := auth(10)
			order := opts.Pagination.OrderBy
			last := &domain.Event{ID: first[1].ID, CreatedAt: first[1].CreatedAt}
			opts.Pagination.Cursor = pagination.New(order, events.Schema.ValuesFrom(last, order.Columns)).Marshal()
			assert.Equal(t, []row{{"evt-003", false}, {"evt-001", true}}, read(t, opts, match))
		})
		t.Run("oldest first", func(t *testing.T) {
			opts := auth(2)
			opts.Pagination.OrderBy = events.CreatedAtAsc()
			assert.Equal(t, []row{{"evt-001", true}, {"evt-003", false}}, read(t, opts, match))
		})
		t.Run("nothing to match matches every row", func(t *testing.T) {
			assert.Equal(t, []row{{"evt-005", true}, {"evt-004", true}}, read(t, auth(2), nil))
		})
	})
}

// A list whose filter no index holds whole is read a budget at a time
// (events.ScanEach). Followed to its end, it must be the list one ordered
// read under the whole filter would serve: every match once, in order,
// wherever the budgets ran out and however many pages came back short.
func TestEventStatements_ScanEach(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, _ := uniqueEventIDs(t)
		ensureEventProject(t, d.stmts, projectID)

		// Twenty events over three categories. The application alternates in
		// runs of three, so most budgets hold a match; the fingerprint is on
		// two events only, so most budgets hold none.
		categories := []domain.EventCategory{domain.EventCategoryAuth, domain.EventCategoryRequest, domain.EventCategoryEntity}
		var all []*domain.Event
		for i := range 20 {
			event := sampleEvent(projectID, "evt-"+string(rune('a'+i)))
			event.Category = categories[(i*7)%len(categories)]
			event.ClientID = []string{"app_1", "app_2"}[(i/3)%2]
			if i%8 == 4 {
				event.Fingerprint = "fp_rare"
			}
			require.NoError(t, d.stmts.InsertEvent(t.Context(), event))
			all = append(all, event)
		}
		fetch := func(ctx context.Context, ids []string) ([]*domain.Event, error) {
			byID := make([]database.Filter[domain.EventField], len(ids))
			for i, id := range ids {
				byID[i] = database.Equal(database.Col(domain.EventFieldID), id)
			}
			found, err := d.stmts.ListEvents(ctx, &database.ListOptions[domain.EventField]{
				Filter: database.And(database.Equal(database.Col(domain.EventFieldProjectID), projectID), database.Or(byID...)),
			})
			if err != nil {
				return nil, err
			}
			return found.Items, nil
		}
		application := database.Equal(database.Col(domain.EventFieldClientID), "app_1")
		fingerprint := database.Equal(database.Col(domain.EventFieldFingerprint), "fp_rare")
		inTwoCategories := func(e *domain.Event) bool { return e.Category != domain.EventCategoryRequest }

		for name, tc := range map[string]struct {
			values []string
			match  database.Filter[domain.EventField]
			wanted func(*domain.Event) bool
			// Whether some page must come back short of its limit.
			short bool
		}{
			"a common value, over the project's events": {
				match:  application,
				wanted: func(e *domain.Event) bool { return e.ClientID == "app_1" },
				short:  true,
			},
			"a common value, over two categories, merged": {
				values: []string{"auth", "entity"},
				match:  application,
				wanted: func(e *domain.Event) bool { return e.ClientID == "app_1" && inTwoCategories(e) },
			},
			"a rare value, over the project's events": {
				match:  fingerprint,
				wanted: func(e *domain.Event) bool { return e.Fingerprint == "fp_rare" },
				short:  true,
			},
			"a rare value, over two categories, merged": {
				values: []string{"auth", "entity"},
				match:  fingerprint,
				wanted: func(e *domain.Event) bool { return e.Fingerprint == "fp_rare" && inTwoCategories(e) },
				short:  true,
			},
		} {
			for _, order := range []database.OrderBy[domain.EventField]{events.CreatedAtDesc(), events.CreatedAtAsc()} {
				direction := "newest first"
				if order.Direction == database.OrderAsc {
					direction = "oldest first"
				}
				t.Run(name+", "+direction, func(t *testing.T) {
					var want []string
					for _, event := range all {
						if tc.wanted(event) {
							want = append(want, event.ID)
						}
					}
					if order.Direction == database.OrderDesc {
						slices.Reverse(want)
					}

					var got []string
					var cursor []byte
					short := 0
					for pages := 0; ; pages++ {
						require.Less(t, pages, len(all)+1, "the list must end")
						opts := events.ListOptions(projectID, 2)
						opts.Pagination.OrderBy = order
						opts.Pagination.Cursor = cursor
						page, err := events.ScanEach(t.Context(), d.stmts.ScanEvents, fetch, opts, domain.EventFieldCategory, tc.values, tc.match, 3)
						require.NoError(t, err)
						require.LessOrEqual(t, len(page.Items), 2)
						for _, item := range page.Items {
							assert.True(t, tc.wanted(item), "the whole event, loaded by id: %s", item.ID)
						}
						got = append(got, eventIDs(page.Items)...)
						if len(page.NextCursor) == 0 {
							break
						}
						if len(page.Items) < 2 {
							short++
						}
						cursor = page.NextCursor
					}
					assert.Equal(t, want, got)
					if tc.short {
						assert.Positive(t, short, "a budget of three ran out before a page of two was full")
					}
				})
			}
		}
	})
}

func eventIDs(items []*domain.Event) []string {
	ids := make([]string, len(items))
	for i, item := range items {
		ids[i] = item.ID
	}
	return ids
}

func TestEventStatements_Get_NotFound(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, _ := uniqueEventIDs(t)
		ensureEventProject(t, d.stmts, projectID)

		_, err := d.stmts.GetEventByID(t.Context(), projectID, "evt_missing")
		require.Error(t, err)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

func TestEventStatements_DeleteOlderThan(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, _ := uniqueEventIDs(t)
		ensureEventProject(t, d.stmts, projectID)

		entity := sampleEvent(projectID, "")
		require.NoError(t, d.stmts.InsertEvent(t.Context(), entity))

		n, err := d.stmts.DeleteEventsOlderThan(t.Context(), time.Now().UTC().Add(time.Hour))
		require.NoError(t, err)
		// Unscoped purge may delete events from other tests sharing the DB.
		assert.GreaterOrEqual(t, n, int64(1))

		_, err = d.stmts.GetEventByID(t.Context(), projectID, entity.ID)
		require.Error(t, err)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

func TestEventStatements_DeleteOlderThan_OrphanedProject(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, eventID := uniqueEventIDs(t)
		project := newTestProject(projectID)
		require.NoError(t, d.stmts.CreateProject(t.Context(), project))

		entity := sampleEvent(projectID, eventID)
		require.NoError(t, d.stmts.InsertEvent(t.Context(), entity))

		changed, err := d.stmts.DeleteProjectByID(t.Context(), projectID)
		require.NoError(t, err)
		require.True(t, changed)

		// Project gone from ListProjects, but unscoped retention still purges.
		n, err := d.stmts.DeleteEventsOlderThan(t.Context(), time.Now().UTC().Add(time.Hour))
		require.NoError(t, err)
		assert.GreaterOrEqual(t, n, int64(1))

		_, err = d.stmts.GetEventByID(t.Context(), projectID, eventID)
		require.Error(t, err)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

func TestEventStatements_SinkCursor(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, _ := uniqueEventIDs(t)
		ensureEventProject(t, d.stmts, projectID)

		sink := &domain.EventSink{
			Type:    domain.EventSinkTypeWebhook,
			Scope:   domain.EventSinkScopeDeployment,
			URL:     "https://example.invalid/sink-" + uniqueSuffix(t),
			Enabled: true,
		}
		require.NoError(t, d.stmts.EnsureEventSink(t.Context(), sink))
		require.NotEmpty(t, sink.ID)

		cursor, err := d.stmts.GetEventSinkCursor(t.Context(), sink.ID, projectID)
		require.NoError(t, err)
		assert.Nil(t, cursor)

		first := sampleEvent(projectID, "evt-cursor-001")
		require.NoError(t, d.stmts.InsertEvent(t.Context(), first))
		second := sampleEvent(projectID, "evt-cursor-002")
		second.EventType = domain.EventTypeUserDeleted
		require.NoError(t, d.stmts.InsertEvent(t.Context(), second))

		all, err := d.stmts.ListEventsAfterCursor(t.Context(), projectID, time.Time{}, "", 10)
		require.NoError(t, err)
		require.Len(t, all, 2)
		assert.Equal(t, "evt-cursor-001", all[0].ID)
		assert.Equal(t, "evt-cursor-002", all[1].ID)

		require.NoError(t, d.stmts.UpsertEventSinkCursor(t.Context(), &domain.EventSinkCursor{
			SinkID:        sink.ID,
			ProjectID:     projectID,
			LastCreatedAt: first.CreatedAt,
			LastEventID:   first.ID,
		}))
		got, err := d.stmts.GetEventSinkCursor(t.Context(), sink.ID, projectID)
		require.NoError(t, err)
		assert.Equal(t, first.ID, got.LastEventID)

		rest, err := d.stmts.ListEventsAfterCursor(t.Context(), projectID, first.CreatedAt, first.ID, 10)
		require.NoError(t, err)
		require.Len(t, rest, 1)
		assert.Equal(t, "evt-cursor-002", rest[0].ID)

		require.NoError(t, d.stmts.UpsertEventSinkCursor(t.Context(), &domain.EventSinkCursor{
			SinkID:        sink.ID,
			ProjectID:     projectID,
			LastCreatedAt: second.CreatedAt,
			LastEventID:   second.ID,
		}))
		got, err = d.stmts.GetEventSinkCursor(t.Context(), sink.ID, projectID)
		require.NoError(t, err)
		assert.Equal(t, second.ID, got.LastEventID)
	})
}

// A transaction that stamps its event before another one but commits after it
// must not lose the event to a reader that ships between the two commits. A
// reader that listed the later event moved its cursor past the earlier one,
// which sorts before the cursor once it commits. Postgres stamped created_at
// with now(), the transaction's start, so the shipper skipped such an event
// for good.
func TestEventStatements_ListAfterCursor_LateCommitNotSkipped(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		if d.name == "sqlite" {
			// A single writer: BEGIN IMMEDIATE blocks the late transaction
			// until the early one commits.
			t.Skip("sqlite serializes writers; interleaving not constructible")
		}
		projectID, _ := uniqueEventIDs(t)
		ensureEventProject(t, d.stmts, projectID)

		// ship lists what follows the cursor and moves the cursor past it, as
		// the shipper does.
		var (
			shipped []string
			afterAt time.Time
			afterID string
		)
		ship := func() {
			t.Helper()
			batch, err := d.stmts.ListEventsAfterCursor(t.Context(), projectID, afterAt, afterID, 10)
			require.NoError(t, err)
			for _, ev := range batch {
				shipped = append(shipped, ev.ID)
				afterAt, afterID = ev.CreatedAt, ev.ID
			}
		}

		early := sampleEvent(projectID, "evt-early")
		var once sync.Once
		inserted := make(chan struct{})
		commit := make(chan struct{})
		// A failed assertion must not leave the early transaction open.
		release := sync.OnceFunc(func() { close(commit) })
		t.Cleanup(release)
		earlyErr := make(chan error, 1)
		go func() {
			// No require in here: it would leave inserted open and hang the test.
			earlyErr <- d.pool.Transaction(context.Background(), func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
				if err := tx.Statements().InsertEvent(ctx, early); err != nil {
					return err
				}
				// Once per attempt: spanner replays aborted attempts.
				once.Do(func() { close(inserted) })
				<-commit
				return nil
			})
		}()
		select {
		case <-inserted:
		case err := <-earlyErr:
			t.Fatalf("the early transaction ended before it inserted its event: %v", err)
		}

		late := sampleEvent(projectID, "evt-late")
		require.NoError(t, d.pool.Transaction(t.Context(), func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
			return tx.Statements().InsertEvent(ctx, late)
		}))

		ship()
		release()
		require.NoError(t, <-earlyErr)
		ship()

		assert.ElementsMatch(t, []string{early.ID, late.ID}, shipped,
			"every event ships once, whichever transaction commits first")
	})
}

// An open transaction that writes one project's events holds back that
// project's readers only: another project's events stay listable meanwhile.
func TestEventStatements_ListAfterCursor_OtherProjectsWriterDoesNotHoldBack(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		if d.name == "sqlite" {
			// One connection: the open transaction would block the insert.
			t.Skip("sqlite runs one transaction at a time; interleaving not constructible")
		}
		busyID, _ := uniqueEventIDs(t)
		ensureEventProject(t, d.stmts, busyID)
		quietID, _ := uniqueEventIDs(t)
		ensureEventProject(t, d.stmts, quietID)

		var once sync.Once
		inserted := make(chan struct{})
		commit := make(chan struct{})
		// A failed assertion must not leave the open transaction open.
		release := sync.OnceFunc(func() { close(commit) })
		t.Cleanup(release)
		openErr := make(chan error, 1)
		go func() {
			// No require in here: it would leave inserted open and hang the test.
			openErr <- d.pool.Transaction(context.Background(), func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
				if err := tx.Statements().InsertEvent(ctx, sampleEvent(busyID, "evt-open")); err != nil {
					return err
				}
				// Once per attempt: spanner replays aborted attempts.
				once.Do(func() { close(inserted) })
				<-commit
				return nil
			})
		}()
		select {
		case <-inserted:
		case err := <-openErr:
			t.Fatalf("the open transaction ended before it inserted its event: %v", err)
		}

		quiet := sampleEvent(quietID, "evt-quiet")
		require.NoError(t, d.stmts.InsertEvent(t.Context(), quiet))
		listed, err := d.stmts.ListEventsAfterCursor(t.Context(), quietID, time.Time{}, "", 10)
		require.NoError(t, err)
		require.Len(t, listed, 1, "another project's open transaction must not hold this project back")
		assert.Equal(t, quiet.ID, listed[0].ID)

		release()
		require.NoError(t, <-openErr)
	})
}

func TestEventStatements_EnsureSinkNaturalKey(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		url := "https://example.invalid/reuse-" + uniqueSuffix(t)
		first := &domain.EventSink{
			Type:    domain.EventSinkTypeWebhook,
			Scope:   domain.EventSinkScopeDeployment,
			URL:     url,
			Enabled: true,
		}
		require.NoError(t, d.stmts.EnsureEventSink(t.Context(), first))
		require.True(t, domain.PrefixEventSink.Matches(first.ID))

		second := &domain.EventSink{
			Type:    domain.EventSinkTypeWebhook,
			Scope:   domain.EventSinkScopeDeployment,
			URL:     url,
			Enabled: true,
		}
		require.NoError(t, d.stmts.EnsureEventSink(t.Context(), second))
		assert.Equal(t, first.ID, second.ID)
	})
}

func TestEventStatements_SurviveProjectHardDelete(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, eventID := uniqueEventIDs(t)
		project := newTestProject(projectID)
		require.NoError(t, d.stmts.CreateProject(t.Context(), project))

		prior := sampleEvent(projectID, eventID)
		require.NoError(t, d.stmts.InsertEvent(t.Context(), prior))

		deleted := &domain.Event{
			ProjectID:  projectID,
			EventType:  domain.EventTypeProjectDeleted,
			Category:   domain.EventCategoryEntity,
			EntityType: ptr("project"),
			EntityID:   ptr(projectID),
			ClientID:   "app_test",
			Payload:    json.RawMessage(`{}`),
			Metadata:   json.RawMessage(`{}`),
		}
		require.NoError(t, d.stmts.InsertEvent(t.Context(), deleted))
		require.NotEmpty(t, deleted.ID)

		_, err := d.stmts.DeleteProjectByID(t.Context(), projectID)
		require.NoError(t, err)
		gotPrior, err := d.stmts.GetEventByID(t.Context(), projectID, eventID)
		require.NoError(t, err)
		assert.Equal(t, prior.EventType, gotPrior.EventType)

		gotDeleted, err := d.stmts.GetEventByID(t.Context(), projectID, deleted.ID)
		require.NoError(t, err)
		assert.Equal(t, domain.EventTypeProjectDeleted, gotDeleted.EventType)
	})
}

func ptr[T any](v T) *T { return &v }
