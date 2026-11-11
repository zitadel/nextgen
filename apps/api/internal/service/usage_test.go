package service_test

import (
	"context"
	"errors"
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

func newMockedUsageService(t *testing.T, counts bool) (*service.UsageService, *servicemocks.MockAllStatements) {
	t.Helper()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	statements := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(statements).AnyTimes()
	return service.NewUsageService(service.NewPool(pool), counts), statements
}

var october = time.Date(2026, time.October, 1, 0, 0, 0, 0, time.UTC)

func octoberRequest(granularity service.UsageGranularity) service.GetUsageRequest {
	return service.GetUsageRequest{ProjectID: "proj_1", From: october, To: october.AddDate(0, 1, 0), Granularity: granularity}
}

func TestUsageService_Get_daysSumTheirHours(t *testing.T) {
	svc, stmts := newMockedUsageService(t, true)
	mau := domain.MeterMonthlyActiveUsers
	stmts.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(&domain.Project{ID: "proj_1"}, nil)
	stmts.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_1").Return(&domain.AuthzAssignment{PrincipalID: "team_1"}, nil)
	stmts.EXPECT().ReadUsageHours(gomock.Any(), "proj_1", []string{mau}, october, october.AddDate(0, 1, 0)).Return([]domain.UsageHour{
		{Meter: mau, Hour: october.Add(9 * time.Hour), Value: 3},
		{Meter: mau, Hour: october.Add(23 * time.Hour), Value: 2},
		{Meter: mau, Hour: october.Add(24 * time.Hour), Value: 4},
	}, nil)
	stmts.EXPECT().GetUsageCursor(gomock.Any(), "proj_1").Return(&domain.UsageCursor{CountedBefore: october.Add(30*time.Hour + 17*time.Minute)}, nil)

	resp, err := svc.Get(context.Background(), octoberRequest(service.UsageByDay))
	require.NoError(t, err)
	assert.Equal(t, []service.UsageBucket{
		{Meter: mau, Start: october, Value: 5},
		{Meter: mau, Start: october.AddDate(0, 0, 1), Value: 4},
	}, resp.Buckets)
	require.NotNil(t, resp.SealedThrough)
	assert.Equal(t, october.Add(30*time.Hour), *resp.SealedThrough, "sealed through the cursor's hour")
	require.NotNil(t, resp.TeamID)
	assert.Equal(t, "team_1", *resp.TeamID)
}

// A standalone deployment never claims its projects, and its usage counts
// all the same: only the team is missing.
func TestUsageService_Get_unclaimedNamesNoTeam(t *testing.T) {
	svc, stmts := newMockedUsageService(t, true)
	mau := domain.MeterMonthlyActiveUsers
	stmts.EXPECT().GetProjectByID(gomock.Any(), "proj_1").Return(&domain.Project{ID: "proj_1"}, nil)
	stmts.EXPECT().GetActiveOwningTeamGrant(gomock.Any(), "proj_1").Return(nil, database.NewNoRowFoundError(nil))
	stmts.EXPECT().ReadUsageHours(gomock.Any(), "proj_1", []string{mau}, october, october.AddDate(0, 1, 0)).
		Return([]domain.UsageHour{{Meter: mau, Hour: october.Add(9 * time.Hour), Value: 3}}, nil)
	stmts.EXPECT().GetUsageCursor(gomock.Any(), "proj_1").Return(nil, nil)

	resp, err := svc.Get(context.Background(), octoberRequest(service.UsageByHour))
	require.NoError(t, err)
	assert.Equal(t, []service.UsageBucket{{Meter: mau, Start: october.Add(9 * time.Hour), Value: 3}}, resp.Buckets)
	assert.Nil(t, resp.TeamID)
	assert.Nil(t, resp.SealedThrough, "nothing sealed before the first count")
}

func TestUsageService_Get_refusesWhatItCannotAnswer(t *testing.T) {
	svc, _ := newMockedUsageService(t, true)
	for name, req := range map[string]service.GetUsageRequest{
		"a day off midnight":   {ProjectID: "proj_1", From: october.Add(time.Hour), To: october.AddDate(0, 0, 2), Granularity: service.UsageByDay},
		"an hour off the hour": {ProjectID: "proj_1", From: october, To: october.Add(90 * time.Minute), Granularity: service.UsageByHour},
		"to before from":       {ProjectID: "proj_1", From: october, To: october, Granularity: service.UsageByDay},
		"more than 31 days":    {ProjectID: "proj_1", From: october, To: october.AddDate(0, 0, 32), Granularity: service.UsageByDay},
		"an unknown meter":     {ProjectID: "proj_1", From: october, To: october.AddDate(0, 0, 1), Granularity: service.UsageByDay, Meters: []string{"nope"}},
		"a granularity":        {ProjectID: "proj_1", From: october, To: october.AddDate(0, 0, 1), Granularity: "week"},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := svc.Get(context.Background(), req)
			assert.True(t, errors.Is(err, domain.ErrUsageInvalid(nil)), "got %v", err)
		})
	}
}

func TestUsageService_Get_disabledDeployment(t *testing.T) {
	svc, _ := newMockedUsageService(t, false)
	_, err := svc.Get(context.Background(), octoberRequest(service.UsageByDay))
	assert.True(t, errors.Is(err, domain.ErrUsageDisabled()), "got %v", err)
}
