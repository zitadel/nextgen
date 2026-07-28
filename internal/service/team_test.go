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
	t.Run("ok", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		pool := servicemocks.NewMockPool(ctrl)
		statements := servicemocks.NewMockAllStatements(ctrl)
		pool.EXPECT().Statements().Return(statements)
		statements.EXPECT().
			CreateTeam(gomock.Any(), gomock.Any()).
			DoAndReturn(func(_ context.Context, team *domain.Team) error {
				assert.Equal(t, "proj_1", team.ProjectID)
				assert.Equal(t, "team-1", team.Name)
				assert.NotEmpty(t, team.ID)
				team.CreatedAt = time.Now()
				team.UpdatedAt = team.CreatedAt
				team.Status = domain.TeamStatusActive
				return nil
			})

		svc := service.NewTeamService(service.NewPool(pool))
		got, err := svc.CreateTeam(t.Context(), service.CreateTeamInput{ProjectID: "proj_1", Name: "team-1"})
		require.NoError(t, err)
		assert.Equal(t, "proj_1", got.ProjectID)
		assert.Equal(t, "team-1", got.Name)
		assert.NotEmpty(t, got.ID)
		assert.False(t, got.CreatedAt.IsZero())
	})

	t.Run("empty name", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		pool := servicemocks.NewMockPool(ctrl)

		svc := service.NewTeamService(service.NewPool(pool))
		_, err := svc.CreateTeam(t.Context(), service.CreateTeamInput{ProjectID: "proj_1"})
		assert.ErrorIs(t, err, domain.ErrTeamNameInvalid())
	})

	t.Run("duplicate name", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		pool := servicemocks.NewMockPool(ctrl)
		statements := servicemocks.NewMockAllStatements(ctrl)
		pool.EXPECT().Statements().Return(statements)
		statements.EXPECT().
			CreateTeam(gomock.Any(), gomock.Any()).
			Return(database.NewUniqueError("teams", "teams_project_id_name_key", nil))

		svc := service.NewTeamService(service.NewPool(pool))
		_, err := svc.CreateTeam(t.Context(), service.CreateTeamInput{ProjectID: "proj_1", Name: "team-1"})
		assert.ErrorIs(t, err, domain.ErrTeamAlreadyExists())
	})

	t.Run("create fails", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		pool := servicemocks.NewMockPool(ctrl)
		statements := servicemocks.NewMockAllStatements(ctrl)
		pool.EXPECT().Statements().Return(statements)
		statements.EXPECT().CreateTeam(gomock.Any(), gomock.Any()).Return(assert.AnError)

		svc := service.NewTeamService(service.NewPool(pool))
		_, err := svc.CreateTeam(t.Context(), service.CreateTeamInput{ProjectID: "proj_1", Name: "team-1"})
		require.Error(t, err)
	})
}

func TestTeamService_GetTeam(t *testing.T) {
	t.Run("ok", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		pool := servicemocks.NewMockPool(ctrl)
		statements := servicemocks.NewMockAllStatements(ctrl)
		pool.EXPECT().Statements().Return(statements)
		statements.EXPECT().
			GetTeamByID(gomock.Any(), "proj_1", "team_1").
			Return(&domain.Team{
				ProjectID: "proj_1",
				ID:        "team_1",
				Name:      "team-1",
				Status:    domain.TeamStatusActive,
				CreatedAt: time.Now(),
				UpdatedAt: time.Now(),
			}, nil)

		svc := service.NewTeamService(service.NewPool(pool))
		got, err := svc.GetTeam(t.Context(), "proj_1", "team_1")
		require.NoError(t, err)
		assert.Equal(t, "proj_1", got.ProjectID)
		assert.Equal(t, "team_1", got.ID)
		assert.Equal(t, "team-1", got.Name)
	})

	t.Run("not found", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		pool := servicemocks.NewMockPool(ctrl)
		statements := servicemocks.NewMockAllStatements(ctrl)
		pool.EXPECT().Statements().Return(statements)
		statements.EXPECT().
			GetTeamByID(gomock.Any(), "proj_1", "missing").
			Return(nil, database.NewNoRowFoundError(nil))

		svc := service.NewTeamService(service.NewPool(pool))
		_, err := svc.GetTeam(t.Context(), "proj_1", "missing")
		require.Error(t, err)
		assert.Equal(t, domain.ErrTeamNotFound().Error(), err.Error())
	})
}
