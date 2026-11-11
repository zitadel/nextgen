package service_test

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/events"
)

func newMockedEventService(t *testing.T) (*service.EventService, *servicemocks.MockAllStatements) {
	t.Helper()
	return newMockedEventServiceOnPlatform(t, "")
}

// newMockedEventServiceOnPlatform builds the service for a deployment whose
// platform project is platformProjectID; empty, it has none.
func newMockedEventServiceOnPlatform(t *testing.T, platformProjectID string) (*service.EventService, *servicemocks.MockAllStatements) {
	t.Helper()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	statements := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(statements).AnyTimes()
	return service.NewEventService(service.NewPool(pool), platformProjectID), statements
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

	_, err := svc.Get(context.Background(), "proj_1", "evt_1", nil)
	require.Error(t, err)
	assert.Equal(t, domain.ErrEventNotFound().Code, err.(domain.Error).Code)
}

// The platform project is never claimed, but its admins read its events from
// the start (ADR 049 §4): neither list nor get asks for a claim.
func TestEventService_platformProjectVisibleUnclaimed(t *testing.T) {
	svc, stmts := newMockedEventServiceOnPlatform(t, "proj_platform")

	want := &domain.Event{ProjectID: "proj_platform", ID: "evt_1", EventType: domain.EventTypeUserCreated, Category: domain.EventCategoryEntity}
	stmts.EXPECT().ListEvents(gomock.Any(), gomock.Any()).
		Return(&database.ListResult[*domain.Event]{Items: []*domain.Event{want}}, nil)
	stmts.EXPECT().GetEventByID(gomock.Any(), "proj_platform", "evt_1").Return(want, nil)

	resp, err := svc.List(context.Background(), service.ListEventsRequest{ProjectID: "proj_platform"})
	require.NoError(t, err)
	require.Len(t, resp.Events, 1)
	assert.Equal(t, "evt_1", resp.Events[0].ID)

	got, err := svc.Get(context.Background(), "proj_platform", "evt_1", nil)
	require.NoError(t, err)
	assert.Equal(t, want, got)
}

// Naming a platform project lets only that one through: an unclaimed customer
// project stays hidden.
func TestEventService_unclaimedCustomerProjectHiddenBesidePlatform(t *testing.T) {
	svc, stmts := newMockedEventServiceOnPlatform(t, "proj_platform")

	stmts.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(&domain.Project{ID: "proj_1"}, nil).Times(2)
	stmts.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_1").Return(nil, database.NewNoRowFoundError(nil)).Times(2)

	resp, err := svc.List(context.Background(), service.ListEventsRequest{ProjectID: "proj_1"})
	require.NoError(t, err)
	assert.Empty(t, resp.Events)
	assert.Empty(t, resp.NextPageToken)

	_, err = svc.Get(context.Background(), "proj_1", "evt_1", nil)
	require.ErrorIs(t, err, domain.ErrEventNotFound())
}

// A deployment without a platform project gates every project on its claim,
// the built-in platform id included.
func TestEventService_noPlatformProjectGatesEveryProject(t *testing.T) {
	svc, stmts := newMockedEventServiceOnPlatform(t, "")

	stmts.EXPECT().GetProjectByID(gomock.Any(), domain.PlatformProjectID).Return(&domain.Project{ID: domain.PlatformProjectID}, nil).Times(2)
	stmts.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), domain.PlatformProjectID).Return(nil, database.NewNoRowFoundError(nil)).Times(2)

	resp, err := svc.List(context.Background(), service.ListEventsRequest{ProjectID: domain.PlatformProjectID})
	require.NoError(t, err)
	assert.Empty(t, resp.Events)

	_, err = svc.Get(context.Background(), domain.PlatformProjectID, "evt_1", nil)
	require.ErrorIs(t, err, domain.ErrEventNotFound())
}

// operatorAnswers is a PlatformOperatorCheck that answers operator and err,
// and counts how often it was asked.
func operatorAnswers(operator bool, err error) (service.PlatformOperatorCheck, *int) {
	asked := new(int)
	return func(context.Context) (bool, error) {
		*asked++
		return operator, err
	}, asked
}

// expectUnclaimed answers the claim lookups for an existing, unclaimed project
// times times.
func expectUnclaimed(stmts *servicemocks.MockAllStatements, projectID string, times int) {
	stmts.EXPECT().GetProjectByID(gomock.Any(), projectID).Return(&domain.Project{ID: projectID}, nil).Times(times)
	stmts.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), projectID).Return(nil, database.NewNoRowFoundError(nil)).Times(times)
}

// A platform operator reads a project nobody has claimed: list and get each
// ask the question once, after the claim lookup came back empty (ADR 049 §4).
func TestEventService_operatorReadsUnclaimedProject(t *testing.T) {
	svc, stmts := newMockedEventServiceOnPlatform(t, "proj_platform")
	expectUnclaimed(stmts, "proj_1", 2)

	want := &domain.Event{ProjectID: "proj_1", ID: "evt_1", EventType: domain.EventTypeProjectCreated, Category: domain.EventCategoryAdmin}
	stmts.EXPECT().ListEvents(gomock.Any(), gomock.Any()).
		Return(&database.ListResult[*domain.Event]{Items: []*domain.Event{want}}, nil)
	stmts.EXPECT().GetEventByID(gomock.Any(), "proj_1", "evt_1").Return(want, nil)
	operator, asked := operatorAnswers(true, nil)

	resp, err := svc.List(context.Background(), service.ListEventsRequest{ProjectID: "proj_1", PlatformOperator: operator})
	require.NoError(t, err)
	require.Len(t, resp.Events, 1)
	assert.Equal(t, "evt_1", resp.Events[0].ID)

	got, err := svc.Get(context.Background(), "proj_1", "evt_1", operator)
	require.NoError(t, err)
	assert.Equal(t, want, got)
	assert.Equal(t, 2, *asked)
}

// Anyone else, the project's own secret and a platform user who is no
// operator among them, still sees nothing of an unclaimed project. A caller
// the handler never asks about (nil) is no operator either.
func TestEventService_unclaimedProjectHiddenFromNonOperators(t *testing.T) {
	notOperator, _ := operatorAnswers(false, nil)
	for name, check := range map[string]service.PlatformOperatorCheck{
		"not an operator": notOperator,
		"never asked":     nil,
	} {
		t.Run(name, func(t *testing.T) {
			svc, stmts := newMockedEventServiceOnPlatform(t, "proj_platform")
			expectUnclaimed(stmts, "proj_1", 2)

			resp, err := svc.List(context.Background(), service.ListEventsRequest{ProjectID: "proj_1", PlatformOperator: check})
			require.NoError(t, err)
			assert.Empty(t, resp.Events)
			assert.Empty(t, resp.NextPageToken)

			_, err = svc.Get(context.Background(), "proj_1", "evt_1", check)
			require.ErrorIs(t, err, domain.ErrEventNotFound())
		})
	}
}

// The question costs nothing where the claim already answers: a claimed
// project and the platform project show their events without it, and a
// project that is gone shows nothing, to an operator too.
func TestEventService_operatorAskedOnlyOfUnclaimedProjects(t *testing.T) {
	never := func(context.Context) (bool, error) {
		t.Error("the platform operator question was asked")
		return true, nil
	}
	svc, stmts := newMockedEventServiceOnPlatform(t, "proj_platform")

	stmts.EXPECT().GetProjectByID(gomock.Any(), "proj_claimed").Return(&domain.Project{ID: "proj_claimed"}, nil)
	stmts.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_claimed").Return(&domain.AuthzAssignment{PrincipalID: "team_1"}, nil)
	stmts.EXPECT().ListEvents(gomock.Any(), gomock.Any()).
		Return(&database.ListResult[*domain.Event]{Items: []*domain.Event{}}, nil).Times(2)
	resp, err := svc.List(context.Background(), service.ListEventsRequest{ProjectID: "proj_claimed", PlatformOperator: never})
	require.NoError(t, err)
	assert.Empty(t, resp.Events)

	_, err = svc.List(context.Background(), service.ListEventsRequest{ProjectID: "proj_platform", PlatformOperator: never})
	require.NoError(t, err)

	stmts.EXPECT().GetProjectByID(gomock.Any(), "proj_gone").Return(nil, database.NewNoRowFoundError(nil)).Times(2)
	resp, err = svc.List(context.Background(), service.ListEventsRequest{ProjectID: "proj_gone", PlatformOperator: never})
	require.NoError(t, err)
	assert.Empty(t, resp.Events)
	_, err = svc.Get(context.Background(), "proj_gone", "evt_1", never)
	require.ErrorIs(t, err, domain.ErrEventNotFound())
}

// A question that could not be answered fails the request: it is never an
// empty page or a 404 (internal/AGENTS.md).
func TestEventService_operatorCheckFailureIsAServerFault(t *testing.T) {
	svc, stmts := newMockedEventServiceOnPlatform(t, "proj_platform")
	expectUnclaimed(stmts, "proj_1", 2)
	failed, _ := operatorAnswers(false, domain.ErrInternal(errors.New("database down")))

	resp, err := svc.List(context.Background(), service.ListEventsRequest{ProjectID: "proj_1", PlatformOperator: failed})
	require.ErrorIs(t, err, domain.ErrInternal(nil))
	assert.Nil(t, resp)

	_, err = svc.Get(context.Background(), "proj_1", "evt_1", failed)
	require.ErrorIs(t, err, domain.ErrInternal(nil))
	assert.NotErrorIs(t, err, domain.ErrEventNotFound())
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

// Each list is planned onto the index that holds the most of its filter, as
// ranges that each stop at the page (ListEvents). What the index does not
// hold is matched row by row over its ranges, no further than the budget
// (ScanEvents).
func TestEventService_List_plansEachReadOntoAnIndex(t *testing.T) {
	project := database.Equal(database.Col(domain.EventFieldProjectID), "proj_1")
	equal := func(field domain.EventField, value string) database.Filter[domain.EventField] {
		return database.Equal(database.Col(field), value)
	}
	// What every read of a list shares: the project and what the index leads with.
	base := func(within ...database.Filter[domain.EventField]) database.Filter[domain.EventField] {
		return database.And(append([]database.Filter[domain.EventField]{project}, within...)...)
	}
	// One range per value of field.
	each := func(field domain.EventField, values []string, within ...database.Filter[domain.EventField]) []database.Filter[domain.EventField] {
		ranges := make([]database.Filter[domain.EventField], len(values))
		for i, value := range values {
			ranges[i] = database.And(base(within...), equal(field, value))
		}
		return ranges
	}
	one := func(within ...database.Filter[domain.EventField]) []database.Filter[domain.EventField] {
		return []database.Filter[domain.EventField]{base(within...)}
	}
	// The operation_status keys of operations in classes, operation by
	// operation.
	keys := func(operations, classes []string) []string {
		var keys []string
		for _, operation := range operations {
			for _, class := range classes {
				keys = append(keys, operation+" "+class)
			}
		}
		return keys
	}
	// One range per operation and status class.
	byOperation := func(operations, classes []string) []database.Filter[domain.EventField] {
		return each(domain.EventFieldOperationStatus, keys(operations, classes))
	}
	everyCategory := []string{"request", "auth", "session", "admin", "entity", "signal"}
	everyClass := []string{"1xx", "2xx", "3xx", "4xx", "5xx"}
	after := time.Date(2026, 11, 3, 8, 0, 0, 0, time.UTC)

	for name, tc := range map[string]struct {
		req service.ListEventsRequest
		// The ranges read, each to the page.
		lists []database.Filter[domain.EventField]
		// The ranges read to the budget, and what is matched over them.
		scans []database.Filter[domain.EventField]
		match database.Filter[domain.EventField]
	}{
		"no filter: the time index": {
			lists: one(),
		},
		"one category": {
			req:   service.ListEventsRequest{Categories: []string{"auth"}},
			lists: each(domain.EventFieldCategory, []string{"auth"}),
		},
		"one type": {
			req:   service.ListEventsRequest{EventTypes: []string{"user.created"}},
			lists: each(domain.EventFieldEventType, []string{"user.created"}),
		},
		"several types": {
			req:   service.ListEventsRequest{EventTypes: []string{"user.created", "user.deleted"}},
			lists: each(domain.EventFieldEventType, []string{"user.created", "user.deleted"}),
		},
		"one request": {
			req:   service.ListEventsRequest{RequestID: "req_1"},
			lists: one(equal(domain.EventFieldRequestID, "req_1")),
		},
		"one login flow": {
			req:   service.ListEventsRequest{FlowID: "flow_1"},
			lists: one(equal(domain.EventFieldFlowID, "flow_1")),
		},
		"one actor, every category: its index is by category": {
			req:   service.ListEventsRequest{ActorID: "user_1"},
			lists: each(domain.EventFieldCategory, everyCategory, equal(domain.EventFieldActorID, "user_1")),
		},
		"one actor, some categories": {
			req:   service.ListEventsRequest{ActorID: "user_1", Categories: []string{"auth", "admin"}},
			lists: each(domain.EventFieldCategory, []string{"auth", "admin"}, equal(domain.EventFieldActorID, "user_1")),
		},
		"one session, every category: its index is by category too": {
			req:   service.ListEventsRequest{SessionID: "sess_1"},
			lists: each(domain.EventFieldCategory, everyCategory, equal(domain.EventFieldSessionID, "sess_1")),
		},
		"one session, some categories": {
			req:   service.ListEventsRequest{SessionID: "sess_1", Categories: []string{"auth", "admin"}},
			lists: each(domain.EventFieldCategory, []string{"auth", "admin"}, equal(domain.EventFieldSessionID, "sess_1")),
		},
		"one resource in one category": {
			req:   service.ListEventsRequest{EntityID: "user_2", Categories: []string{"entity"}},
			lists: each(domain.EventFieldCategory, []string{"entity"}, equal(domain.EventFieldEntityID, "user_2")),
		},
		"the time bounds narrow every range": {
			req: service.ListEventsRequest{ActorID: "user_1", Categories: []string{"auth"}, CreatedAfter: &after},
			lists: each(domain.EventFieldCategory, []string{"auth"},
				equal(domain.EventFieldActorID, "user_1"),
				database.GreaterThanOrEqual(database.Col(domain.EventFieldCreatedAt), after)),
		},
		"a resource and an actor: the resource reads, the actor is matched": {
			req:   service.ListEventsRequest{EntityID: "user_2", ActorID: "user_1", Categories: []string{"entity"}},
			scans: each(domain.EventFieldCategory, []string{"entity"}, equal(domain.EventFieldEntityID, "user_2")),
			match: database.And(equal(domain.EventFieldActorID, "user_1")),
		},
		"a request beside anything: the request reads": {
			req:   service.ListEventsRequest{RequestID: "req_1", SessionID: "sess_1", Categories: []string{"auth", "admin"}},
			scans: one(equal(domain.EventFieldRequestID, "req_1")),
			match: database.And(
				equal(domain.EventFieldSessionID, "sess_1"),
				database.Or(equal(domain.EventFieldCategory, "auth"), equal(domain.EventFieldCategory, "admin")),
			),
		},
		"a type beside an actor: the actor reads, by category": {
			req:   service.ListEventsRequest{ActorID: "user_1", EventTypes: []string{"user.created"}},
			scans: each(domain.EventFieldCategory, everyCategory, equal(domain.EventFieldActorID, "user_1")),
			match: database.And(equal(domain.EventFieldEventType, "user.created")),
		},
		"a type beside categories: the type reads": {
			req:   service.ListEventsRequest{EventTypes: []string{"user.created"}, Categories: []string{"entity", "admin"}},
			scans: each(domain.EventFieldEventType, []string{"user.created"}),
			match: database.And(database.Or(equal(domain.EventFieldCategory, "entity"), equal(domain.EventFieldCategory, "admin"))),
		},
		"what no index holds is matched over the time index": {
			req:   service.ListEventsRequest{ClientID: "app_1", TeamID: "team_1"},
			scans: one(),
			match: database.And(equal(domain.EventFieldClientID, "app_1"), equal(domain.EventFieldTeamID, "team_1")),
		},
		"what no index holds is matched over the range of what one does": {
			req:   service.ListEventsRequest{Categories: []string{"auth"}, Fingerprint: "fp_1"},
			scans: each(domain.EventFieldCategory, []string{"auth"}),
			match: database.And(equal(domain.EventFieldFingerprint, "fp_1")),
		},
		"one resource type, every category: its index is by category": {
			req:   service.ListEventsRequest{EntityType: "user"},
			lists: each(domain.EventFieldCategory, everyCategory, equal(domain.EventFieldEntityType, "user")),
		},
		"one resource type, some categories": {
			req:   service.ListEventsRequest{EntityType: "user", Categories: []string{"auth", "entity"}},
			lists: each(domain.EventFieldCategory, []string{"auth", "entity"}, equal(domain.EventFieldEntityType, "user")),
		},
		"a resource beside its type: the resource reads, the type is matched": {
			req:   service.ListEventsRequest{EntityType: "user", EntityID: "user_2", Categories: []string{"entity"}},
			scans: each(domain.EventFieldCategory, []string{"entity"}, equal(domain.EventFieldEntityID, "user_2")),
			match: database.And(equal(domain.EventFieldEntityType, "user")),
		},
		"a resource type beside a type: the resource type reads, by category": {
			req:   service.ListEventsRequest{EntityType: "user", EventTypes: []string{"user.created"}, Fingerprint: "fp_1"},
			scans: each(domain.EventFieldCategory, everyCategory, equal(domain.EventFieldEntityType, "user")),
			match: database.And(equal(domain.EventFieldEventType, "user.created"), equal(domain.EventFieldFingerprint, "fp_1")),
		},
		"one operation, every status class: its index is by status class": {
			req:   service.ListEventsRequest{OperationIDs: []string{"createUser"}},
			lists: byOperation([]string{"createUser"}, everyClass),
		},
		"operations in some status classes, each named once": {
			req: service.ListEventsRequest{
				OperationIDs:  []string{"createUser", "deleteUser", "createUser"},
				StatusClasses: []string{"4xx", "5xx", "4xx"},
			},
			lists: byOperation([]string{"createUser", "deleteUser"}, []string{"4xx", "5xx"}),
		},
		"one status class": {
			req:   service.ListEventsRequest{StatusClasses: []string{"5xx"}},
			lists: each(domain.EventFieldStatusClass, []string{"5xx"}),
		},
		"several status classes: the failed requests": {
			req:   service.ListEventsRequest{StatusClasses: []string{"4xx", "5xx"}},
			lists: each(domain.EventFieldStatusClass, []string{"4xx", "5xx"}),
		},
		"the time bounds narrow an operation's ranges": {
			req: service.ListEventsRequest{OperationIDs: []string{"createUser"}, StatusClasses: []string{"5xx"}, CreatedAfter: &after},
			lists: each(domain.EventFieldOperationStatus, []string{"createUser 5xx"},
				database.GreaterThanOrEqual(database.Col(domain.EventFieldCreatedAt), after)),
		},
		"an operation beside a session: the session reads, the operation in its classes is matched": {
			req:   service.ListEventsRequest{SessionID: "sess_1", OperationIDs: []string{"createUser"}, StatusClasses: []string{"4xx", "5xx"}},
			scans: each(domain.EventFieldCategory, everyCategory, equal(domain.EventFieldSessionID, "sess_1")),
			match: database.And(database.Or(
				equal(domain.EventFieldOperationStatus, "createUser 4xx"),
				equal(domain.EventFieldOperationStatus, "createUser 5xx"),
			)),
		},
		"a status class beside an actor: the actor reads, the class is matched": {
			req:   service.ListEventsRequest{ActorID: "user_1", StatusClasses: []string{"5xx"}, Categories: []string{"request"}},
			scans: each(domain.EventFieldCategory, []string{"request"}, equal(domain.EventFieldActorID, "user_1")),
			match: database.And(equal(domain.EventFieldStatusClass, "5xx")),
		},
		"an operation beside a request: the request reads, the operation in every class is matched": {
			req:   service.ListEventsRequest{RequestID: "req_1", OperationIDs: []string{"createUser"}},
			scans: one(equal(domain.EventFieldRequestID, "req_1")),
			match: database.And(database.Or(
				equal(domain.EventFieldOperationStatus, "createUser 1xx"),
				equal(domain.EventFieldOperationStatus, "createUser 2xx"),
				equal(domain.EventFieldOperationStatus, "createUser 3xx"),
				equal(domain.EventFieldOperationStatus, "createUser 4xx"),
				equal(domain.EventFieldOperationStatus, "createUser 5xx"),
			)),
		},
		"an operation beside a type and a category: the operation reads": {
			req:   service.ListEventsRequest{OperationIDs: []string{"createUser"}, EventTypes: []string{"request.api"}, Categories: []string{"request"}},
			scans: byOperation([]string{"createUser"}, everyClass),
			match: database.And(equal(domain.EventFieldCategory, "request"), equal(domain.EventFieldEventType, "request.api")),
		},
		"a status class beside a type: the class reads": {
			req:   service.ListEventsRequest{StatusClasses: []string{"5xx"}, EventTypes: []string{"request.api"}},
			scans: each(domain.EventFieldStatusClass, []string{"5xx"}),
			match: database.And(equal(domain.EventFieldEventType, "request.api")),
		},
	} {
		t.Run(name, func(t *testing.T) {
			svc, stmts := newMockedEventService(t)
			stmts.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(&domain.Project{ID: "proj_1"}, nil)
			stmts.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_1").Return(&domain.AuthzAssignment{PrincipalID: "team_1"}, nil)

			var lists, scans []database.Filter[domain.EventField]
			stmts.EXPECT().ListEvents(gomock.Any(), gomock.Any()).Times(len(tc.lists)).
				DoAndReturn(func(_ context.Context, opts *database.ListOptions[domain.EventField]) (*database.ListResult[*domain.Event], error) {
					lists = append(lists, opts.Filter)
					assert.Equal(t, uint32(20), opts.Pagination.Limit, "a range an index holds whole stops at the page")
					return &database.ListResult[*domain.Event]{}, nil
				})
			stmts.EXPECT().ScanEvents(gomock.Any(), gomock.Any(), gomock.Any()).Times(len(tc.scans)).
				DoAndReturn(func(_ context.Context, within *database.ListOptions[domain.EventField], match database.Filter[domain.EventField]) ([]events.Scanned, error) {
					scans = append(scans, within.Filter)
					assert.Equal(t, tc.match, match)
					assert.Equal(t, uint32(1000), within.Pagination.Limit, "a range that is matched row by row stops at the budget")
					return nil, nil
				})

			tc.req.ProjectID = "proj_1"
			_, err := svc.List(context.Background(), tc.req)
			require.NoError(t, err)
			assert.Equal(t, tc.lists, lists)
			assert.Equal(t, tc.scans, scans)
		})
	}
}

// A filter no index holds is matched over a bounded number of rows, so the
// page says what matched so far and where to go on, and the events
// themselves are loaded by id.
func TestEventService_List_matchesOverABudget(t *testing.T) {
	svc, stmts := newMockedEventService(t)
	stmts.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(&domain.Project{ID: "proj_1"}, nil).Times(2)
	stmts.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_1").Return(&domain.AuthzAssignment{PrincipalID: "team_1"}, nil).Times(2)

	at := time.Date(2026, 11, 10, 8, 0, 0, 0, time.UTC)
	// A thousand rows, the budget, of which the second matches.
	full := make([]events.Scanned, 1000)
	for i := range full {
		full[i] = events.Scanned{ID: "evt_" + strconv.Itoa(1000-i), CreatedAt: at.Add(-time.Duration(i) * time.Second), Matched: i == 1}
	}
	var cursors [][]byte
	stmts.EXPECT().ScanEvents(gomock.Any(), gomock.Any(), gomock.Any()).Times(2).
		DoAndReturn(func(_ context.Context, within *database.ListOptions[domain.EventField], _ database.Filter[domain.EventField]) ([]events.Scanned, error) {
			cursors = append(cursors, within.Pagination.Cursor)
			if len(cursors) == 1 {
				return full, nil
			}
			// Behind the budget, the range ends without another match.
			return []events.Scanned{{ID: "evt_0", CreatedAt: at.Add(-time.Hour)}}, nil
		})
	stmts.EXPECT().ListEvents(gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, opts *database.ListOptions[domain.EventField]) (*database.ListResult[*domain.Event], error) {
			assert.Equal(t, database.And(
				database.Equal(database.Col(domain.EventFieldProjectID), "proj_1"),
				database.Or(database.Equal(database.Col(domain.EventFieldID), "evt_999")),
			), opts.Filter, "the page's events, by id")
			return &database.ListResult[*domain.Event]{Items: []*domain.Event{{ProjectID: "proj_1", ID: "evt_999"}}}, nil
		})

	req := service.ListEventsRequest{ProjectID: "proj_1", ClientID: "app_1", Limit: 25}
	first, err := svc.List(context.Background(), req)
	require.NoError(t, err)
	require.Len(t, first.Events, 1, "what matched in the rows read, short of the page")
	assert.Equal(t, "evt_999", first.Events[0].ID)
	require.NotEmpty(t, first.NextPageToken, "the budget ran out: the range may hold more")

	req.PageToken = first.NextPageToken
	second, err := svc.List(context.Background(), req)
	require.NoError(t, err)
	assert.Empty(t, second.Events)
	assert.Empty(t, second.NextPageToken, "the range was read to its end")
	require.Len(t, cursors, 2)
	assert.Empty(t, cursors[0])
	assert.Equal(t, first.NextPageToken, string(cursors[1]), "the next call goes on behind the last row read")
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

	got, err := svc.Get(context.Background(), "proj_1", "evt_1", nil)
	require.NoError(t, err)
	assert.Equal(t, "evt_1", got.ID)
}
