package service_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func newMockedEventService(t *testing.T) (*service.EventService, *servicemocks.MockAllStatements) {
	t.Helper()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	statements := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(statements).AnyTimes()
	return service.NewEventService(service.NewPool(pool)), statements
}

func TestEventService_List_preClaimEmpty(t *testing.T) {
	svc, stmts := newMockedEventService(t)

	stmts.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(&domain.Project{ID: "proj_1"}, nil)
	stmts.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_1").Return(nil, database.NewNoRowFoundError(nil))

	resp, err := svc.List(context.Background(), service.ListEventsRequest{ProjectID: "proj_1"})
	require.NoError(t, err)
	assert.Empty(t, resp.Events)
	assert.Empty(t, resp.NextPageToken)
}

func TestEventService_Get_preClaimNotFound(t *testing.T) {
	svc, stmts := newMockedEventService(t)

	stmts.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(&domain.Project{ID: "proj_1"}, nil)
	stmts.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_1").Return(nil, database.NewNoRowFoundError(nil))

	_, err := svc.Get(context.Background(), "proj_1", "evt_1")
	require.Error(t, err)
	assert.Equal(t, domain.ErrEventNotFound().Code, err.(domain.Error).Code)
}

func TestEventService_List_claimedAppliesFilters(t *testing.T) {
	svc, stmts := newMockedEventService(t)

	stmts.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(&domain.Project{ID: "proj_1"}, nil)
	stmts.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_1").Return(&domain.AuthzAssignment{PrincipalID: "team_1"}, nil)

	now := time.Now().UTC()
	want := &domain.Event{
		ProjectID: "proj_1",
		ID:        "evt_1",
		EventType: domain.EventTypeUserCreated,
		Category:  domain.EventCategoryEntity,
		CreatedAt: now,
		Payload:   json.RawMessage(`{"user_id":"user_1"}`),
	}
	stmts.EXPECT().ListEvents(gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, opts *database.ListOptions[domain.EventField]) (*database.ListResult[*domain.Event], error) {
			require.NotNil(t, opts.Filter)
			assert.Equal(t, uint32(20), opts.Pagination.Limit)
			assert.Equal(t, database.OrderDesc, opts.Pagination.OrderBy.Direction)
			return &database.ListResult[*domain.Event]{Items: []*domain.Event{want}}, nil
		})

	resp, err := svc.List(context.Background(), service.ListEventsRequest{
		ProjectID:  "proj_1",
		Categories: []string{"entity"},
		EventTypes: []string{"user.created"},
	})
	require.NoError(t, err)
	require.Len(t, resp.Events, 1)
	assert.Equal(t, "evt_1", resp.Events[0].ID)
}

// Several categories are one read each, merged in the page's order, so each
// read is a range of the category index. One statement over all of them
// would walk the project's events or sort every match.
func TestEventService_List_readsEachCategoryOnItsOwn(t *testing.T) {
	svc, stmts := newMockedEventService(t)

	stmts.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(&domain.Project{ID: "proj_1"}, nil)
	stmts.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_1").Return(&domain.AuthzAssignment{PrincipalID: "team_1"}, nil)

	at := time.Date(2026, 11, 10, 8, 0, 0, 0, time.UTC)
	event := func(id string, category domain.EventCategory, second int) *domain.Event {
		return &domain.Event{ProjectID: "proj_1", ID: id, Category: category, CreatedAt: at.Add(time.Duration(second) * time.Second)}
	}
	byCategory := map[domain.EventCategory][]*domain.Event{
		domain.EventCategoryAuth:   {event("evt_4", domain.EventCategoryAuth, 4), event("evt_1", domain.EventCategoryAuth, 1)},
		domain.EventCategoryEntity: {event("evt_3", domain.EventCategoryEntity, 3), event("evt_2", domain.EventCategoryEntity, 2)},
	}
	var asked []database.Filter[domain.EventField]
	stmts.EXPECT().ListEvents(gomock.Any(), gomock.Any()).Times(2).
		DoAndReturn(func(_ context.Context, opts *database.ListOptions[domain.EventField]) (*database.ListResult[*domain.Event], error) {
			asked = append(asked, opts.Filter)
			assert.Equal(t, uint32(3), opts.Pagination.Limit, "each category is asked for a whole page")
			// In the order the service names the categories.
			category := []domain.EventCategory{domain.EventCategoryAuth, domain.EventCategoryEntity}[len(asked)-1]
			return &database.ListResult[*domain.Event]{Items: byCategory[category]}, nil
		})

	resp, err := svc.List(context.Background(), service.ListEventsRequest{
		ProjectID:  "proj_1",
		Categories: []string{"auth", "entity"},
		Limit:      3,
	})
	require.NoError(t, err)

	project := database.Equal(database.Col(domain.EventFieldProjectID), "proj_1")
	category := func(c string) database.Filter[domain.EventField] {
		return database.And(database.And(project), database.Equal(database.Col(domain.EventFieldCategory), c))
	}
	assert.Equal(t, []database.Filter[domain.EventField]{category("auth"), category("entity")}, asked)

	ids := make([]string, len(resp.Events))
	for i, e := range resp.Events {
		ids[i] = e.ID
	}
	assert.Equal(t, []string{"evt_4", "evt_3", "evt_2"}, ids, "newest first across both categories, cut at the page")
	assert.NotEmpty(t, resp.NextPageToken, "a fourth event is left behind the page")
}

// Each list is planned onto the index that serves it in order: one read where
// one range holds the page, a read per category or per type where none does
// (events.ListEach).
func TestEventService_List_plansEachReadOntoAnIndex(t *testing.T) {
	project := database.Equal(database.Col(domain.EventFieldProjectID), "proj_1")
	equal := func(field domain.EventField, value string) database.Filter[domain.EventField] {
		return database.Equal(database.Col(field), value)
	}
	// One read per value of field, each with the request's other filters.
	each := func(field domain.EventField, values []string, rest ...database.Filter[domain.EventField]) []database.Filter[domain.EventField] {
		reads := make([]database.Filter[domain.EventField], len(values))
		for i, value := range values {
			reads[i] = database.And(database.And(append([]database.Filter[domain.EventField]{project}, rest...)...), equal(field, value))
		}
		return reads
	}
	one := func(filters ...database.Filter[domain.EventField]) []database.Filter[domain.EventField] {
		return []database.Filter[domain.EventField]{database.And(append([]database.Filter[domain.EventField]{project}, filters...)...)}
	}
	everyCategory := []string{"request", "auth", "session", "admin", "entity", "signal"}
	anyCategory := func(categories ...string) database.Filter[domain.EventField] {
		ors := make([]database.Filter[domain.EventField], len(categories))
		for i, category := range categories {
			ors[i] = equal(domain.EventFieldCategory, category)
		}
		return database.Or(ors...)
	}

	for name, tc := range map[string]struct {
		req   service.ListEventsRequest
		reads []database.Filter[domain.EventField]
	}{
		"one actor, every category: the actor index is by category": {
			req:   service.ListEventsRequest{ActorID: "user_1"},
			reads: each(domain.EventFieldCategory, everyCategory, equal(domain.EventFieldActorID, "user_1")),
		},
		"one actor, some categories": {
			req:   service.ListEventsRequest{ActorID: "user_1", Categories: []string{"auth", "admin"}},
			reads: each(domain.EventFieldCategory, []string{"auth", "admin"}, equal(domain.EventFieldActorID, "user_1")),
		},
		"one actor, one category: one range": {
			req:   service.ListEventsRequest{ActorID: "user_1", Categories: []string{"admin"}},
			reads: one(equal(domain.EventFieldCategory, "admin"), equal(domain.EventFieldActorID, "user_1")),
		},
		"one type: one range": {
			req:   service.ListEventsRequest{EventTypes: []string{"user.created"}},
			reads: one(equal(domain.EventFieldEventType, "user.created")),
		},
		"several types": {
			req:   service.ListEventsRequest{EventTypes: []string{"user.created", "user.deleted"}},
			reads: each(domain.EventFieldEventType, []string{"user.created", "user.deleted"}),
		},
		"a session holds few events, so its index finds them whatever the categories": {
			req:   service.ListEventsRequest{SessionID: "sess_1", Categories: []string{"auth", "admin"}},
			reads: one(anyCategory("auth", "admin"), equal(domain.EventFieldSessionID, "sess_1")),
		},
		"a resource holds few events, so its index finds them whoever the actor": {
			req:   service.ListEventsRequest{EntityID: "user_2", ActorID: "user_1"},
			reads: one(equal(domain.EventFieldActorID, "user_1"), equal(domain.EventFieldEntityID, "user_2")),
		},
		"a type beside a category is one read, in no index's order": {
			req:   service.ListEventsRequest{EventTypes: []string{"user.created"}, Categories: []string{"entity", "admin"}},
			reads: one(anyCategory("entity", "admin"), equal(domain.EventFieldEventType, "user.created")),
		},
	} {
		t.Run(name, func(t *testing.T) {
			svc, stmts := newMockedEventService(t)
			stmts.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(&domain.Project{ID: "proj_1"}, nil)
			stmts.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_1").Return(&domain.AuthzAssignment{PrincipalID: "team_1"}, nil)

			var reads []database.Filter[domain.EventField]
			stmts.EXPECT().ListEvents(gomock.Any(), gomock.Any()).Times(len(tc.reads)).
				DoAndReturn(func(_ context.Context, opts *database.ListOptions[domain.EventField]) (*database.ListResult[*domain.Event], error) {
					reads = append(reads, opts.Filter)
					return &database.ListResult[*domain.Event]{}, nil
				})

			tc.req.ProjectID = "proj_1"
			_, err := svc.List(context.Background(), tc.req)
			require.NoError(t, err)
			assert.Equal(t, tc.reads, reads)
		})
	}
}

// Paging forward, a token passes every event before its page, so an ascending
// list ends where the project's events are still settling: an event that
// commits behind a page would be skipped for good.
func TestEventService_List_orderAscEndsWhereEventsSettle(t *testing.T) {
	settled := time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)
	bound := database.LessThan(database.Col(domain.EventFieldCreatedAt), settled)
	for name, tc := range map[string]struct {
		settled time.Time
		bounded bool
	}{
		"events still settling": {settled: settled, bounded: true},
		"every event settled":   {settled: time.Time{}, bounded: false},
	} {
		t.Run(name, func(t *testing.T) {
			svc, stmts := newMockedEventService(t)

			stmts.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(&domain.Project{ID: "proj_1"}, nil)
			stmts.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_1").Return(&domain.AuthzAssignment{PrincipalID: "team_1"}, nil)
			stmts.EXPECT().EventsSettledBefore(gomock.Any(), "proj_1").Return(tc.settled, nil)
			stmts.EXPECT().ListEvents(gomock.Any(), gomock.Any()).
				DoAndReturn(func(_ context.Context, opts *database.ListOptions[domain.EventField]) (*database.ListResult[*domain.Event], error) {
					assert.Equal(t, database.OrderAsc, opts.Pagination.OrderBy.Direction)
					filter, ok := opts.Filter.(database.AndFilter[domain.EventField])
					require.True(t, ok, "filter %T", opts.Filter)
					if tc.bounded {
						assert.Contains(t, filter.Filters, bound)
					} else {
						assert.False(t, filter.Restricts(database.Col(domain.EventFieldCreatedAt)))
					}
					return &database.ListResult[*domain.Event]{}, nil
				})

			_, err := svc.List(context.Background(), service.ListEventsRequest{ProjectID: "proj_1", Order: "asc"})
			require.NoError(t, err)
		})
	}
}

func TestEventService_List_invalidOrder(t *testing.T) {
	svc, stmts := newMockedEventService(t)

	stmts.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(&domain.Project{ID: "proj_1"}, nil)
	stmts.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_1").Return(&domain.AuthzAssignment{PrincipalID: "team_1"}, nil)

	_, err := svc.List(context.Background(), service.ListEventsRequest{ProjectID: "proj_1", Order: "sideways"})
	require.Error(t, err)
	assert.Equal(t, domain.ErrEventInvalid("order must be asc or desc", nil).Code, err.(domain.Error).Code)
}

func TestEventService_Get_claimed(t *testing.T) {
	svc, stmts := newMockedEventService(t)

	stmts.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(&domain.Project{ID: "proj_1"}, nil)
	stmts.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_1").Return(&domain.AuthzAssignment{PrincipalID: "team_1"}, nil)
	stmts.EXPECT().GetEventByID(gomock.Any(), "proj_1", "evt_1").Return(&domain.Event{
		ProjectID: "proj_1", ID: "evt_1", EventType: domain.EventTypeUserCreated,
	}, nil)

	got, err := svc.Get(context.Background(), "proj_1", "evt_1")
	require.NoError(t, err)
	assert.Equal(t, "evt_1", got.ID)
}
