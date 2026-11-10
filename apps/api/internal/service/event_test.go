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
