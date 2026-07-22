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
	"github.com/zitadel/nextgen/internal/storage/database"
)

func TestTeamService_CreateTeam(t *testing.T) {
	tests := []struct {
		name            string
		projectID       string
		setupStatements func(*domain.Team) testAllStatements
		setupPool       func(*servicemocks.MockPool, testAllStatements)
		wantErr         bool
	}{
		{
			name:      "ok",
			projectID: "proj_1",
			setupStatements: func(want *domain.Team) testAllStatements {
				return testAllStatements{
					createTeam: func(_ context.Context, team *domain.Team) error {
						assert.Equal(t, want.ProjectID, team.ProjectID)
						assert.NotEmpty(t, team.ID)
						team.CreatedAt = time.Now()
						team.UpdatedAt = team.CreatedAt
						team.Status = domain.TeamStatusActive
						return nil
					},
				}
			},
			setupPool: func(pool *servicemocks.MockPool, statements testAllStatements) {
				pool.EXPECT().Statements().Return(statements)
			},
		},
		{
			name:      "create fails",
			projectID: "proj_1",
			setupStatements: func(_ *domain.Team) testAllStatements {
				return testAllStatements{
					createTeam: func(context.Context, *domain.Team) error {
						return assert.AnError
					},
				}
			},
			setupPool: func(pool *servicemocks.MockPool, statements testAllStatements) {
				pool.EXPECT().Statements().Return(statements)
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			mockPool := servicemocks.NewMockPool(ctrl)
			want := &domain.Team{ProjectID: tt.projectID}
			statements := testAllStatements{}
			if tt.setupStatements != nil {
				statements = tt.setupStatements(want)
			}
			if tt.setupPool != nil {
				tt.setupPool(mockPool, statements)
			}

			svc := service.NewTeamService(service.NewPool(mockPool))
			got, err := svc.CreateTeam(t.Context(), service.CreateTeamInput{ProjectID: tt.projectID})
			if tt.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.projectID, got.ProjectID)
			assert.NotEmpty(t, got.ID)
			assert.False(t, got.CreatedAt.IsZero())
		})
	}
}

func TestTeamService_GetTeam(t *testing.T) {
	tests := []struct {
		name            string
		projectID       string
		teamID          string
		setupStatements func(string, string) testAllStatements
		setupPool       func(*servicemocks.MockPool, testAllStatements)
		wantErr         error
	}{
		{
			name:      "ok",
			projectID: "proj_1",
			teamID:    "team_1",
			setupStatements: func(projectID, teamID string) testAllStatements {
				return testAllStatements{
					getTeamByID: func(_ context.Context, gotProjectID, gotID string) (*domain.Team, error) {
						assert.Equal(t, projectID, gotProjectID)
						assert.Equal(t, teamID, gotID)
						return &domain.Team{
							ProjectID: projectID,
							ID:        teamID,
							Status:    domain.TeamStatusActive,
							CreatedAt: time.Now(),
							UpdatedAt: time.Now(),
						}, nil
					},
				}
			},
			setupPool: func(pool *servicemocks.MockPool, statements testAllStatements) {
				pool.EXPECT().Statements().Return(statements)
			},
		},
		{
			name:      "not found",
			projectID: "proj_1",
			teamID:    "missing",
			setupStatements: func(string, string) testAllStatements {
				return testAllStatements{
					getTeamByID: func(context.Context, string, string) (*domain.Team, error) {
						return nil, database.NewNoRowFoundError(nil)
					},
				}
			},
			setupPool: func(pool *servicemocks.MockPool, statements testAllStatements) {
				pool.EXPECT().Statements().Return(statements)
			},
			wantErr: domain.ErrTeamNotFound(),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			mockPool := servicemocks.NewMockPool(ctrl)
			statements := tt.setupStatements(tt.projectID, tt.teamID)
			tt.setupPool(mockPool, statements)

			svc := service.NewTeamService(service.NewPool(mockPool))
			got, err := svc.GetTeam(t.Context(), tt.projectID, tt.teamID)
			if tt.wantErr != nil {
				require.Error(t, err)
				assert.Equal(t, tt.wantErr.Error(), err.Error())
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.projectID, got.ProjectID)
			assert.Equal(t, tt.teamID, got.ID)
		})
	}
}
