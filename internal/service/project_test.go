package service_test

import (
	"context"
	"errors"
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
	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
	"go.uber.org/mock/gomock"
)

func TestProjectService_Create(t *testing.T) {
	tests := []struct {
		name                    string
		previewOrigins          []string
		setupStatements         func(*domain.Project) testAllStatements
		setupSchemaRepo         func(*domainmock.MockJSONSchemaRepository)
		setupFlowDefinitionRepo func(*domainmock.MockFlowDefinitionRepository)
		setupPool               func(*servicemocks.MockPool, *dbmock.MockTransaction, testAllStatements)
		setupTokenGenerator     func(generator *domainmock.MockTokenGenerator)
		wantErr                 bool
		check                   func(t *testing.T, got *domain.Project)
	}{
		{
			name:           "ok — no preview origins",
			previewOrigins: nil,
			setupStatements: func(_ *domain.Project) testAllStatements {
				return testAllStatements{
					createProject: func(_ *domain.Project) v2database.Execution {
						return stubV2Execution{}
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
			previewOrigins: []string{"*.vercel.app", "*.netlify.app"},
			setupStatements: func(_ *domain.Project) testAllStatements {
				return testAllStatements{
					createProject: func(project *domain.Project) v2database.Execution {
						assert.Equal(t, []string{"*.vercel.app", "*.netlify.app"}, project.PreviewOrigins)
						return stubV2Execution{}
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
			name:           "CreateProject error",
			previewOrigins: nil,
			setupStatements: func(_ *domain.Project) testAllStatements {
				return testAllStatements{
					createProject: func(_ *domain.Project) v2database.Execution {
						return stubV2Execution{err: errors.New("db error")}
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
			wantErr: true,
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
				nil,
				schemaRepo,
				flowDefinitionRepo,
				tokenGenerator,
				baseURL,
				schemaValidator,
			)
			got, err := svc.Create(context.Background(), tc.previewOrigins)

			if tc.wantErr {
				require.Error(t, err)
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
					getProjectByID: func(gotID string) v2database.Query[domain.Project] {
						assert.Equal(t, id, gotID)
						return stubV2Query[domain.Project]{
							result: &domain.Project{
								ID:        "proj_aaa",
								CreatedAt: now,
								UpdatedAt: now,
							},
						}
					},
				}
			},
			setupPool: func(pool *servicemocks.MockPool, statements testAllStatements) {
				pool.EXPECT().Statements().Return(statements)
			},
			check: func(t *testing.T, got *domain.Project) {
				assert.Equal(t, "proj_aaa", got.ID)
				assert.False(t, got.CreatedAt.IsZero())
			},
		},
		{
			name: "not found",
			id:   "proj_missing",
			setupStatements: func(id string) testAllStatements {
				return testAllStatements{
					getProjectByID: func(gotID string) v2database.Query[domain.Project] {
						assert.Equal(t, id, gotID)
						return stubV2Query[domain.Project]{
							err: database.NewNoRowFoundError(nil),
						}
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
				nil,
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
