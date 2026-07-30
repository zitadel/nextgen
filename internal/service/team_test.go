package service_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func TestTeamService_CreateTeam(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		input     service.CreateTeamInput
		setupStmt func(*servicemocks.MockAllStatements)
		wantErr   error
		check     func(t *testing.T, got *domain.Team)
	}{
		{
			name:  "ok",
			input: service.CreateTeamInput{ProjectID: "proj_1", Name: "team-1"},
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().CreateTeam(gomock.Any(), gomock.Any()).DoAndReturn(
					func(_ context.Context, team *domain.Team) error {
						team.ID = "team_test01"
						team.CreatedAt = time.Now()
						team.UpdatedAt = team.CreatedAt
						team.Status = domain.TeamStatusActive
						return nil
					})
			},
			check: func(t *testing.T, got *domain.Team) {
				assert.Equal(t, "proj_1", got.ProjectID)
				assert.Equal(t, "team-1", got.Name)
				assert.NotEmpty(t, got.ID)
				assert.False(t, got.CreatedAt.IsZero())
			},
		},
		{
			name:    "empty name",
			input:   service.CreateTeamInput{ProjectID: "proj_1"},
			wantErr: domain.ErrTeamNameInvalid(),
		},
		{
			name:  "duplicate name",
			input: service.CreateTeamInput{ProjectID: "proj_1", Name: "team-1"},
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().CreateTeam(gomock.Any(), gomock.Any()).
					Return(database.NewUniqueError("teams", "uq_teams_project_name", nil))
			},
			wantErr: domain.ErrTeamAlreadyExists(),
		},
		{
			name:  "create fails",
			input: service.CreateTeamInput{ProjectID: "proj_1", Name: "team-1"},
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().CreateTeam(gomock.Any(), gomock.Any()).Return(assert.AnError)
			},
			wantErr: domain.ErrInternal(assert.AnError),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			svc := newMockedTeamService(t, tc.setupStmt)

			got, err := svc.CreateTeam(t.Context(), tc.input)
			if tc.wantErr != nil {
				require.ErrorIs(t, err, tc.wantErr)
				assert.Nil(t, got)
				return
			}
			require.NoError(t, err)
			tc.check(t, got)
		})
	}
}

func TestTeamService_GetTeam(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		teamID    string
		setupStmt func(*servicemocks.MockAllStatements)
		wantErr   error
		check     func(t *testing.T, got *domain.Team)
	}{
		{
			name:   "ok",
			teamID: "team_1",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().GetTeamByID(gomock.Any(), "proj_1", "team_1").
					Return(&domain.Team{
						ProjectID: "proj_1",
						ID:        "team_1",
						Name:      "team-1",
						Status:    domain.TeamStatusActive,
						CreatedAt: time.Now(),
						UpdatedAt: time.Now(),
					}, nil)
			},
			check: func(t *testing.T, got *domain.Team) {
				assert.Equal(t, "proj_1", got.ProjectID)
				assert.Equal(t, "team_1", got.ID)
				assert.Equal(t, "team-1", got.Name)
			},
		},
		{
			name:   "not found",
			teamID: "missing",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().GetTeamByID(gomock.Any(), "proj_1", "missing").
					Return(nil, database.NewNoRowFoundError(nil))
			},
			wantErr: domain.ErrTeamNotFound(),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			svc := newMockedTeamService(t, tc.setupStmt)

			got, err := svc.GetTeam(t.Context(), "proj_1", tc.teamID)
			if tc.wantErr != nil {
				require.ErrorIs(t, err, tc.wantErr)
				assert.Nil(t, got)
				return
			}
			require.NoError(t, err)
			tc.check(t, got)
		})
	}
}

func newMockedTeamService(t *testing.T, setupStmt func(*servicemocks.MockAllStatements)) *service.TeamService {
	t.Helper()

	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	if setupStmt != nil {
		statements := servicemocks.NewMockAllStatements(ctrl)
		pool.EXPECT().Statements().Return(statements)
		setupStmt(statements)
	}

	return service.NewTeamService(service.NewPool(pool))
}
