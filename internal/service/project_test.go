package service_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	domainmock "github.com/zitadel/nextgen/internal/domain/mock"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dbmock"
	"go.uber.org/mock/gomock"
)

func TestProjectService_Create(t *testing.T) {
	tests := []struct {
		name                    string
		projectName             string
		previewOrigins          []string
		seedDefaults            bool
		setupStatements         func(*domain.Project) testAllStatements
		setupSchemaRepo         func(*domainmock.MockJSONSchemaRepository)
		setupFlowDefinitionRepo func(*domainmock.MockFlowDefinitionRepository)
		setupPool               func(*servicemocks.MockPool, *dbmock.MockTransaction, testAllStatements)
		setupTokenGenerator     func(generator *domainmock.MockTokenGenerator)
		wantErr                 error
		check                   func(t *testing.T, got *domain.Project)
	}{
		{
			name:    "missing project name",
			wantErr: domain.ErrProjectNameInvalid(),
		},
		{
			name:           "ok — no preview origins",
			projectName:    "test",
			previewOrigins: nil,
			seedDefaults:   true,
			setupStatements: func(_ *domain.Project) testAllStatements {
				return testAllStatements{
					createProject: func(_ context.Context, _ *domain.Project) error {
						return nil
					},
				}
			},
			setupSchemaRepo: func(r *domainmock.MockJSONSchemaRepository) {
				r.EXPECT().Create(gomock.Any(), gomock.Any(), gomock.Any())
			},
			setupFlowDefinitionRepo: func(r *domainmock.MockFlowDefinitionRepository) {
				r.EXPECT().CreateFlowDefinition(gomock.Any(), gomock.Any(), gomock.Any())
			},
			setupPool: func(pool *servicemocks.MockPool, transaction *dbmock.MockTransaction, statements testAllStatements) {
				pool.EXPECT().
					Transaction(gomock.Any(), gomock.Any()).
					DoAndReturn(func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
						return fn(ctx, v2TestTx{
							QueryExecutor: transaction,
							stmts:         statements,
						})
					})
			},
			setupTokenGenerator: func(generator *domainmock.MockTokenGenerator) {
				generator.EXPECT().
					Generate(gomock.Any()).Return("token", nil).
					Times(2)
			},
			check: func(t *testing.T, got *domain.Project) {
				assert.NotNil(t, got)
			},
		},
		{
			name:           "ok — with preview origins",
			projectName:    "test",
			previewOrigins: []string{"*.vercel.app", "*.netlify.app"},
			seedDefaults:   true,
			setupStatements: func(_ *domain.Project) testAllStatements {
				return testAllStatements{
					createProject: func(_ context.Context, project *domain.Project) error {
						assert.Equal(t, []string{"*.vercel.app", "*.netlify.app"}, project.PreviewOrigins)
						return nil
					},
				}
			},
			setupSchemaRepo: func(r *domainmock.MockJSONSchemaRepository) {
				r.EXPECT().Create(gomock.Any(), gomock.Any(), gomock.Any())
			},
			setupFlowDefinitionRepo: func(r *domainmock.MockFlowDefinitionRepository) {
				r.EXPECT().CreateFlowDefinition(gomock.Any(), gomock.Any(), gomock.Any())
			},
			setupPool: func(pool *servicemocks.MockPool, transaction *dbmock.MockTransaction, statements testAllStatements) {
				pool.EXPECT().
					Transaction(gomock.Any(), gomock.Any()).
					DoAndReturn(func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
						return fn(ctx, v2TestTx{
							QueryExecutor: transaction,
							stmts:         statements,
						})
					})
			},
			setupTokenGenerator: func(generator *domainmock.MockTokenGenerator) {
				generator.EXPECT().
					Generate(gomock.Any()).Return("token", nil).
					Times(2)
			},
			check: func(t *testing.T, got *domain.Project) {
				assert.Equal(t, []string{"*.vercel.app", "*.netlify.app"}, got.PreviewOrigins)
			},
		},
		{
			name:           "ok — skip fallback defaults",
			projectName:    "test",
			previewOrigins: nil,
			seedDefaults:   false,
			setupStatements: func(_ *domain.Project) testAllStatements {
				return testAllStatements{
					createProject: func(_ context.Context, _ *domain.Project) error {
						return nil
					},
				}
			},
			setupPool: func(pool *servicemocks.MockPool, transaction *dbmock.MockTransaction, statements testAllStatements) {
				pool.EXPECT().
					Transaction(gomock.Any(), gomock.Any()).
					DoAndReturn(func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
						return fn(ctx, v2TestTx{
							QueryExecutor: transaction,
							stmts:         statements,
						})
					})
			},
			setupTokenGenerator: func(generator *domainmock.MockTokenGenerator) {
				generator.EXPECT().
					Generate(gomock.Any()).Return("token", nil).
					Times(2)
			},
			check: func(t *testing.T, got *domain.Project) {
				assert.NotNil(t, got)
			},
		},
		{
			name:           "CreateProject error",
			projectName:    "test",
			previewOrigins: nil,
			seedDefaults:   true,
			setupStatements: func(_ *domain.Project) testAllStatements {
				return testAllStatements{
					createProject: func(_ context.Context, _ *domain.Project) error {
						return assert.AnError
					},
				}
			},
			setupPool: func(pool *servicemocks.MockPool, transaction *dbmock.MockTransaction, statements testAllStatements) {
				pool.EXPECT().
					Transaction(gomock.Any(), gomock.Any()).
					DoAndReturn(func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
						return fn(ctx, v2TestTx{
							QueryExecutor: transaction,
							stmts:         statements,
						})
					})
			},
			setupTokenGenerator: func(generator *domainmock.MockTokenGenerator) {
				generator.EXPECT().
					Generate(gomock.Any()).Return("token", nil).
					Times(2)
			},
			wantErr: domain.ErrInternal(assert.AnError),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			mockPool := servicemocks.NewMockPool(ctrl)
			transaction := dbmock.NewMockTransaction(ctrl)
			schemaRepo := domainmock.NewMockJSONSchemaRepository(ctrl)
			flowDefinitionRepo := domainmock.NewMockFlowDefinitionRepository(ctrl)
			const baseURL = "https://example.com/api/schemas"
			schemaValidator, err := domain.NewSchemaValidator(baseURL)
			require.NoError(t, err)
			tokenGenerator := domainmock.NewMockTokenGenerator(ctrl)

			statements := testAllStatements{}
			if tc.setupStatements != nil {
				statements = tc.setupStatements(nil)
			}
			if tc.setupSchemaRepo != nil {
				tc.setupSchemaRepo(schemaRepo)
			}
			if tc.setupFlowDefinitionRepo != nil {
				tc.setupFlowDefinitionRepo(flowDefinitionRepo)
			}
			if tc.setupPool != nil {
				tc.setupPool(mockPool, transaction, statements)
			}
			if tc.setupTokenGenerator != nil {
				tc.setupTokenGenerator(tokenGenerator)
			}

			svc := service.NewProjectService(
				stubPool(),
				service.NewPool(mockPool),
				schemaRepo,
				flowDefinitionRepo,
				tokenGenerator,
				baseURL,
				schemaValidator,
			)
			got, err := svc.Create(context.Background(), tc.projectName, tc.previewOrigins, tc.seedDefaults)

			if tc.wantErr != nil {
				require.ErrorIs(t, err, tc.wantErr)
			} else {
				require.NoError(t, err)
			}
			if tc.check != nil {
				tc.check(t, got)
			}
		})
	}
}

func TestProjectService_Get(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)

	tests := []struct {
		name            string
		id              string
		setupStatements func(string) testAllStatements
		setupPool       func(*servicemocks.MockPool, testAllStatements)
		wantErr         bool
		check           func(t *testing.T, got *domain.Project)
	}{
		{
			name: "ok",
			id:   "proj_aaa",
			setupStatements: func(id string) testAllStatements {
				return testAllStatements{
					getProjectByID: func(_ context.Context, gotID string) (*domain.Project, error) {
						assert.Equal(t, id, gotID)
						return &domain.Project{
							ID:        "proj_aaa",
							Name:      "project aaa",
							CreatedAt: now,
							UpdatedAt: now,
						}, nil
					},
				}
			},
			setupPool: func(pool *servicemocks.MockPool, statements testAllStatements) {
				pool.EXPECT().Statements().Return(statements)
			},
			check: func(t *testing.T, got *domain.Project) {
				assert.Equal(t, "project aaa", got.Name)
				assert.Equal(t, "proj_aaa", got.ID)
				assert.False(t, got.CreatedAt.IsZero())
			},
		},
		{
			name: "not found",
			id:   "proj_missing",
			setupStatements: func(id string) testAllStatements {
				return testAllStatements{
					getProjectByID: func(_ context.Context, gotID string) (*domain.Project, error) {
						assert.Equal(t, id, gotID)
						return nil, database.NewNoRowFoundError(nil)
					},
				}
			},
			setupPool: func(pool *servicemocks.MockPool, statements testAllStatements) {
				pool.EXPECT().Statements().Return(statements)
			},
			wantErr: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			mockPool := servicemocks.NewMockPool(ctrl)
			schemaRepo := domainmock.NewMockJSONSchemaRepository(ctrl)
			flowDefinitionRepo := domainmock.NewMockFlowDefinitionRepository(ctrl)
			const baseURL = "https://example.com"
			schemaValidator, err := domain.NewSchemaValidator(baseURL)
			require.NoError(t, err)
			tokenGenerator := domainmock.NewMockTokenGenerator(ctrl)

			statements := tc.setupStatements(tc.id)
			tc.setupPool(mockPool, statements)

			svc := service.NewProjectService(
				stubPool(),
				service.NewPool(mockPool),
				schemaRepo,
				flowDefinitionRepo,
				tokenGenerator,
				baseURL,
				schemaValidator,
			)
			got, err := svc.Get(context.Background(), tc.id)
			require.Equal(t, tc.wantErr, err != nil)
			if tc.check != nil {
				tc.check(t, got)
			}
		})
	}
}

func TestProjectService_Update(t *testing.T) {
	createdAt := time.Now().UTC().Truncate(time.Second)
	updatedAt := time.Now().UTC().Truncate(time.Second).Add(time.Second)
	tests := []struct {
		name            string
		id              string
		projectName     string
		setupStatements func(string) testAllStatements
		setupPool       func(*servicemocks.MockPool, testAllStatements)
		wantErr         error
		check           func(t *testing.T, got *domain.Project)
	}{
		{
			name:    "missing project id",
			wantErr: domain.ErrMissingProjectID(),
		},
		{
			name:    "missing project name",
			id:      "proj_aaa",
			wantErr: domain.ErrProjectNameInvalid(),
		},
		{
			name:        "updated, ok",
			id:          "proj_aaa",
			projectName: "updated project name",
			setupStatements: func(s string) testAllStatements {
				return testAllStatements{
					updateProject: func(ctx context.Context, project *domain.Project) error {
						project.CreatedAt = createdAt
						project.UpdatedAt = updatedAt
						return nil
					},
				}
			},
			setupPool: func(pool *servicemocks.MockPool, statements testAllStatements) {
				pool.EXPECT().Statements().Return(statements)
			},
			check: func(t *testing.T, got *domain.Project) {
				assert.Equal(t, "proj_aaa", got.ID)
				assert.Equal(t, "updated project name", got.Name)
				assert.Equal(t, createdAt, got.CreatedAt)
				assert.Equal(t, updatedAt, got.UpdatedAt)
			},
		},
		{
			name:        "not found",
			id:          "proj_missing",
			projectName: "updated project name",
			setupStatements: func(id string) testAllStatements {
				return testAllStatements{
					updateProject: func(_ context.Context, _ *domain.Project) error {
						return database.NewNoRowFoundError(nil)
					},
				}
			},
			setupPool: func(pool *servicemocks.MockPool, statements testAllStatements) {
				pool.EXPECT().Statements().Return(statements)
			},
			check: func(t *testing.T, got *domain.Project) {
				assert.Nil(t, got)
			},
			wantErr: domain.ErrProjectNotFound(),
		},
		{
			name:        "update error",
			id:          "proj_aaa",
			projectName: "updated project name",
			setupStatements: func(s string) testAllStatements {
				return testAllStatements{
					updateProject: func(_ context.Context, _ *domain.Project) error {
						return assert.AnError
					},
				}
			},
			setupPool: func(pool *servicemocks.MockPool, statements testAllStatements) {
				pool.EXPECT().Statements().Return(statements)
			},
			wantErr: domain.ErrInternal(assert.AnError),
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			mockPool := servicemocks.NewMockPool(ctrl)
			schemaRepo := domainmock.NewMockJSONSchemaRepository(ctrl)
			flowDefinitionRepo := domainmock.NewMockFlowDefinitionRepository(ctrl)
			const baseURL = "https://example.com"
			schemaValidator, err := domain.NewSchemaValidator(baseURL)
			require.NoError(t, err)
			tokenGenerator := domainmock.NewMockTokenGenerator(ctrl)

			if tc.setupStatements != nil {
				statements := tc.setupStatements(tc.id)
				tc.setupPool(mockPool, statements)
			}

			svc := service.NewProjectService(
				stubPool(),
				service.NewPool(mockPool),
				schemaRepo,
				flowDefinitionRepo,
				tokenGenerator,
				baseURL,
				schemaValidator,
			)
			got, err := svc.Update(context.Background(), tc.id, tc.projectName)
			if tc.wantErr != nil {
				require.ErrorIs(t, err, tc.wantErr)
			} else {
				require.NoError(t, err)
			}
			if tc.check != nil {
				tc.check(t, got)
			}
		})
	}
}
