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

func TestTeamService_Create(t *testing.T) {
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

			got, err := svc.Create(t.Context(), tc.input)
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

func TestTeamService_Get(t *testing.T) {
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

			got, err := svc.Get(t.Context(), "proj_1", tc.teamID)
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

func TestTeamService_Update(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		input     service.UpdateTeamInput
		setupStmt func(*servicemocks.MockAllStatements)
		wantErr   error
		check     func(t *testing.T, got *domain.Team)
	}{
		{
			name:  "ok",
			input: service.UpdateTeamInput{ProjectID: "proj_1", TeamID: "team_1", Name: new("renamed")},
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().UpdateTeam(gomock.Any(), &domain.Team{ProjectID: "proj_1", ID: "team_1", Name: "renamed"}).
					DoAndReturn(func(_ context.Context, team *domain.Team) error {
						team.Status = domain.TeamStatusActive
						team.CreatedAt = time.Now()
						team.UpdatedAt = team.CreatedAt
						return nil
					})
			},
			check: func(t *testing.T, got *domain.Team) {
				assert.Equal(t, "proj_1", got.ProjectID)
				assert.Equal(t, "team_1", got.ID)
				assert.Equal(t, "renamed", got.Name)
				assert.Equal(t, domain.TeamStatusActive, got.Status)
				assert.False(t, got.CreatedAt.IsZero())
			},
		},
		{
			name:  "name is trimmed before the update",
			input: service.UpdateTeamInput{ProjectID: "proj_1", TeamID: "team_1", Name: new("  renamed  ")},
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().UpdateTeam(gomock.Any(), &domain.Team{ProjectID: "proj_1", ID: "team_1", Name: "renamed"}).
					Return(nil)
			},
			check: func(t *testing.T, got *domain.Team) {
				assert.Equal(t, "renamed", got.Name)
			},
		},
		{
			name:    "whitespace-only name",
			input:   service.UpdateTeamInput{ProjectID: "proj_1", TeamID: "team_1", Name: new("   ")},
			wantErr: domain.ErrTeamNameInvalid(),
		},
		{
			name:    "omitted name",
			input:   service.UpdateTeamInput{ProjectID: "proj_1", TeamID: "team_1"},
			wantErr: domain.ErrTeamNameInvalid(),
		},
		{
			name:  "duplicate name",
			input: service.UpdateTeamInput{ProjectID: "proj_1", TeamID: "team_1", Name: new("renamed")},
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().UpdateTeam(gomock.Any(), &domain.Team{ProjectID: "proj_1", ID: "team_1", Name: "renamed"}).
					Return(database.NewUniqueError("teams", "uq_teams_project_name", nil))
			},
			wantErr: domain.ErrTeamAlreadyExists(),
		},
		{
			name:  "team not found",
			input: service.UpdateTeamInput{ProjectID: "proj_1", TeamID: "missing", Name: new("renamed")},
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().UpdateTeam(gomock.Any(), &domain.Team{ProjectID: "proj_1", ID: "missing", Name: "renamed"}).
					Return(database.NewNoRowFoundError(nil))
			},
			wantErr: domain.ErrTeamNotFound(),
		},
		{
			name:  "update fails",
			input: service.UpdateTeamInput{ProjectID: "proj_1", TeamID: "team_1", Name: new("renamed")},
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().UpdateTeam(gomock.Any(), gomock.Any()).Return(assert.AnError)
			},
			wantErr: domain.ErrInternal(assert.AnError),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			svc := newMockedTeamService(t, tc.setupStmt)
			got, err := svc.Update(t.Context(), tc.input)
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
