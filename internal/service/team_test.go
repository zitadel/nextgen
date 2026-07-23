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
	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
)

// testAllStatements is a lightweight AllStatements stub for TeamService unit tests.
type testAllStatements struct {
	createTeam     func(context.Context, *domain.Team) error
	getTeamByID    func(context.Context, string, string) (*domain.Team, error)
	deactivateTeam func(context.Context, string, string) error
}

func (testAllStatements) IsStatements() {}

func (testAllStatements) CreateProject(context.Context, *domain.Project) error {
	panic("unexpected call to CreateProject")
}

func (testAllStatements) GetProjectByID(context.Context, string) (*domain.Project, error) {
	panic("unexpected call to GetProjectByID")
}

func (testAllStatements) UpdateProject(context.Context, *domain.Project) error {
	panic("unexpected call to UpdateProject")
}

func (testAllStatements) ListProjects(context.Context, *v2database.ListOptions[domain.ProjectField]) (*v2database.ListResult[*domain.Project], error) {
	panic("unexpected call to ListProjects")
}

func (testAllStatements) DeleteProjectByID(context.Context, string) error {
	panic("unexpected call to DeleteProjectByID")
}

func (testAllStatements) CreateFlowDefinition(context.Context, *domain.FlowDefinition) error {
	panic("unexpected call to CreateFlowDefinition")
}

func (testAllStatements) GetFlowDefinitionByID(context.Context, string) (*domain.FlowDefinition, error) {
	panic("unexpected call to GetFlowDefinitionByID")
}

func (testAllStatements) ListFlowDefinitions(context.Context, *v2database.ListOptions[domain.FlowDefinitionField]) (*v2database.ListResult[*domain.FlowDefinition], error) {
	panic("unexpected call to ListFlowDefinitions")
}

func (testAllStatements) DeleteFlowDefinitionByID(context.Context, string) error {
	panic("unexpected call to DeleteFlowDefinitionByID")
}

func (testAllStatements) GetEncryptionKey(context.Context, v2database.Filter[domain.EncryptionKeyField]) (*domain.EncryptionKey, error) {
	panic("unexpected call to GetEncryptionKey")
}

func (testAllStatements) CreateEncryptionKey(context.Context, *domain.EncryptionKey) error {
	panic("unexpected call to CreateEncryptionKey")
}

func (testAllStatements) CreateJSONSchema(context.Context, *domain.JSONSchema) error {
	panic("unexpected call to CreateJSONSchema")
}

func (testAllStatements) GetJSONSchemaByID(context.Context, string, string) (*domain.JSONSchema, error) {
	panic("unexpected call to GetJSONSchemaByID")
}

func (testAllStatements) ListJSONSchemas(context.Context, *v2database.ListOptions[domain.JSONSchemaField]) (*v2database.ListResult[*domain.JSONSchema], error) {
	panic("unexpected call to ListJSONSchemas")
}

func (testAllStatements) DeleteJSONSchemaByID(context.Context, string, string) error {
	panic("unexpected call to DeleteJSONSchemaByID")
}

func (s testAllStatements) CreateTeam(ctx context.Context, team *domain.Team) error {
	if s.createTeam != nil {
		return s.createTeam(ctx, team)
	}
	return nil
}

func (s testAllStatements) GetTeamByID(ctx context.Context, projectID, id string) (*domain.Team, error) {
	if s.getTeamByID != nil {
		return s.getTeamByID(ctx, projectID, id)
	}
	return nil, nil
}

func (s testAllStatements) DeactivateTeam(ctx context.Context, projectID, id string) error {
	if s.deactivateTeam != nil {
		return s.deactivateTeam(ctx, projectID, id)
	}
	panic("unexpected call to DeactivateTeam")
}

var _ service.AllStatements = testAllStatements{}

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
