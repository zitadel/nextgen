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
	stmts.EXPECT().GetResourceScope(gomock.Any(), "proj_1").Return(&domain.ResourceScope{
		ResourceID: "proj_1", ProjectID: "proj_1",
	}, nil)

	resp, err := svc.List(context.Background(), service.ListEventsRequest{ProjectID: "proj_1"})
	require.NoError(t, err)
	assert.Empty(t, resp.Events)
	assert.Empty(t, resp.NextPageToken)
}

func TestEventService_Get_preClaimNotFound(t *testing.T) {
	svc, stmts := newMockedEventService(t)

	stmts.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(&domain.Project{ID: "proj_1"}, nil)
	stmts.EXPECT().GetResourceScope(gomock.Any(), "proj_1").Return(&domain.ResourceScope{
		ResourceID: "proj_1", ProjectID: "proj_1",
	}, nil)

	_, err := svc.Get(context.Background(), "proj_1", "evt_1")
	require.Error(t, err)
	assert.Equal(t, domain.ErrEventNotFound().Code, err.(domain.Error).Code)
}

func TestEventService_List_claimedAppliesFilters(t *testing.T) {
	svc, stmts := newMockedEventService(t)

	teamID := "team_1"
	stmts.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(&domain.Project{ID: "proj_1"}, nil)
	stmts.EXPECT().GetResourceScope(gomock.Any(), "proj_1").Return(&domain.ResourceScope{
		ResourceID: "proj_1", ProjectID: "proj_1", TeamID: &teamID,
	}, nil)

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

func TestEventService_Get_claimed(t *testing.T) {
	svc, stmts := newMockedEventService(t)

	teamID := "team_1"
	stmts.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(&domain.Project{ID: "proj_1"}, nil)
	stmts.EXPECT().GetResourceScope(gomock.Any(), "proj_1").Return(&domain.ResourceScope{
		ResourceID: "proj_1", ProjectID: "proj_1", TeamID: &teamID,
	}, nil)
	stmts.EXPECT().GetEventByID(gomock.Any(), "proj_1", "evt_1").Return(&domain.Event{
		ProjectID: "proj_1", ID: "evt_1", EventType: domain.EventTypeUserCreated,
	}, nil)

	got, err := svc.Get(context.Background(), "proj_1", "evt_1")
	require.NoError(t, err)
	assert.Equal(t, "evt_1", got.ID)
}
