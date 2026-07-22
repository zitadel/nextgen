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
	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
	"go.uber.org/mock/gomock"
)

func TestProjectService_Create(t *testing.T) {
	t.Parallel()
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
			t.Parallel()
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
	t.Parallel()
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
							ID:             "proj_aaa",
							Name:           "project aaa",
							PreviewOrigins: []string{"*.vercel.app"},
							CreatedAt:      now,
							UpdatedAt:      now,
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
				assert.Equal(t, []string{"*.vercel.app"}, got.PreviewOrigins)
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
			t.Parallel()
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
	t.Parallel()
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
			t.Parallel()
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

func TestProjectService_Delete(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name            string
		id              string
		setupStatements func() testAllStatements
		setupPool       func(*servicemocks.MockPool, testAllStatements)
		wantErr         error
	}{
		{
			name:    "missing project id",
			wantErr: domain.ErrMissingProjectID(),
		},
		{
			name: "deleted, ok",
			id:   "proj_aaa",
			setupStatements: func() testAllStatements {
				return testAllStatements{
					deleteProject: func(_ context.Context, id string) error {
						assert.Equal(t, "proj_aaa", id)
						return nil
					},
				}
			},
			setupPool: func(pool *servicemocks.MockPool, statements testAllStatements) {
				pool.EXPECT().Statements().Return(statements)
			},
		},
		{
			name: "delete failed",
			id:   "proj_aaa",
			setupStatements: func() testAllStatements {
				return testAllStatements{
					deleteProject: func(_ context.Context, _ string) error {
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
			t.Parallel()
			ctrl := gomock.NewController(t)
			mockPool := servicemocks.NewMockPool(ctrl)
			schemaRepo := domainmock.NewMockJSONSchemaRepository(ctrl)
			flowDefinitionRepo := domainmock.NewMockFlowDefinitionRepository(ctrl)
			const baseURL = "https://example.com"
			schemaValidator, err := domain.NewSchemaValidator(baseURL)
			require.NoError(t, err)
			tokenGenerator := domainmock.NewMockTokenGenerator(ctrl)

			if tc.setupStatements != nil {
				statements := tc.setupStatements()
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
			err = svc.Delete(context.Background(), tc.id)
			if tc.wantErr != nil {
				require.ErrorIs(t, err, tc.wantErr)
			} else {
				require.NoError(t, err)
			}
		})
	}
}

func TestProjectService_List(t *testing.T) {
	t.Parallel()
	createdAt := time.Now().UTC().Truncate(time.Second)

	tests := []struct {
		name         string
		req          service.ListProjectsRequest
		result       *v2database.ListResult[*domain.Project]
		statementErr error
		wantErr      error
		checkOpts    func(t *testing.T, opts *v2database.ListOptions[domain.ProjectField])
		checkResp    func(t *testing.T, resp *service.ListProjectsResponse)
	}{
		{
			name: "defaults",
			req:  service.ListProjectsRequest{},
			result: &v2database.ListResult[*domain.Project]{
				Items:      []*domain.Project{{ID: "proj_a"}, {ID: "proj_b"}},
				NextCursor: []byte("next"),
			},
			checkOpts: func(t *testing.T, opts *v2database.ListOptions[domain.ProjectField]) {
				assert.Equal(t, uint32(20), opts.Pagination.Limit)
				assert.Nil(t, opts.Pagination.Cursor)
				assert.Equal(t, v2database.OrderAsc, opts.Pagination.OrderBy.Direction)
				assert.Equal(t, []v2database.Column[domain.ProjectField]{
					v2database.Col(domain.ProjectFieldCreatedAt),
					v2database.Col(domain.ProjectFieldID),
				}, opts.Pagination.OrderBy.Columns)
				assert.Equal(t, v2database.And[domain.ProjectField](), opts.Filter)
			},
			checkResp: func(t *testing.T, resp *service.ListProjectsResponse) {
				assert.Len(t, resp.Projects, 2)
				assert.Equal(t, "next", resp.NextPageToken)
			},
		},
		{
			name:   "limit clamped to max",
			req:    service.ListProjectsRequest{Limit: 500},
			result: &v2database.ListResult[*domain.Project]{},
			checkOpts: func(t *testing.T, opts *v2database.ListOptions[domain.ProjectField]) {
				assert.Equal(t, uint32(100), opts.Pagination.Limit)
			},
		},
		{
			name:   "negative limit uses default",
			req:    service.ListProjectsRequest{Limit: -5},
			result: &v2database.ListResult[*domain.Project]{},
			checkOpts: func(t *testing.T, opts *v2database.ListOptions[domain.ProjectField]) {
				assert.Equal(t, uint32(20), opts.Pagination.Limit)
			},
		},
		{
			name: "sort by name desc",
			req: service.ListProjectsRequest{
				Sorting: &service.Sorting{Field: "name", Direction: "desc"},
			},
			result: &v2database.ListResult[*domain.Project]{},
			checkOpts: func(t *testing.T, opts *v2database.ListOptions[domain.ProjectField]) {
				assert.Equal(t, v2database.OrderDesc, opts.Pagination.OrderBy.Direction)
				assert.Equal(t, []v2database.Column[domain.ProjectField]{
					v2database.Col(domain.ProjectFieldName),
					v2database.Col(domain.ProjectFieldID),
				}, opts.Pagination.OrderBy.Columns)
			},
		},
		{
			name: "filter equals name",
			req: service.ListProjectsRequest{
				Filters: []service.Filter{{Field: "name", Operation: "equals", Value: "acme"}},
			},
			result: &v2database.ListResult[*domain.Project]{},
			checkOpts: func(t *testing.T, opts *v2database.ListOptions[domain.ProjectField]) {
				assert.Equal(t, v2database.And(
					v2database.StringEqual(v2database.Col(domain.ProjectFieldName), "acme"),
				), opts.Filter)
			},
		},
		{
			name: "filter greater_than createdAt parses RFC3339",
			req: service.ListProjectsRequest{
				Filters: []service.Filter{{Field: "createdAt", Operation: "greater_than", Value: createdAt.Format(time.RFC3339)}},
			},
			result: &v2database.ListResult[*domain.Project]{},
			checkOpts: func(t *testing.T, opts *v2database.ListOptions[domain.ProjectField]) {
				assert.Equal(t, v2database.And(
					v2database.GreaterThan(v2database.Col(domain.ProjectFieldCreatedAt), createdAt),
				), opts.Filter)
			},
		},
		{
			name:   "page token passed through as cursor",
			req:    service.ListProjectsRequest{PageToken: "tok"},
			result: &v2database.ListResult[*domain.Project]{},
			checkOpts: func(t *testing.T, opts *v2database.ListOptions[domain.ProjectField]) {
				assert.Equal(t, []byte("tok"), opts.Pagination.Cursor)
			},
		},
		{
			name:         "statement error is wrapped",
			req:          service.ListProjectsRequest{},
			statementErr: assert.AnError,
			wantErr:      domain.ErrInternal(assert.AnError),
		},
		{
			name:         "invalid cursor maps to request invalid",
			req:          service.ListProjectsRequest{PageToken: "bad"},
			statementErr: v2database.ErrInvalidCursor(),
			wantErr:      domain.ErrRequestInvalid(),
		},
		{
			name:         "cursor order mismatch maps to request invalid",
			req:          service.ListProjectsRequest{PageToken: "bad"},
			statementErr: v2database.ErrCursorOrderMismatch(),
			wantErr:      domain.ErrRequestInvalid(),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			ctrl := gomock.NewController(t)
			mockPool := servicemocks.NewMockPool(ctrl)
			schemaRepo := domainmock.NewMockJSONSchemaRepository(ctrl)
			flowDefinitionRepo := domainmock.NewMockFlowDefinitionRepository(ctrl)
			const baseURL = "https://example.com"
			schemaValidator, err := domain.NewSchemaValidator(baseURL)
			require.NoError(t, err)
			tokenGenerator := domainmock.NewMockTokenGenerator(ctrl)

			var gotOpts *v2database.ListOptions[domain.ProjectField]
			mockPool.EXPECT().Statements().Return(testAllStatements{
				listProjects: func(_ context.Context, opts *v2database.ListOptions[domain.ProjectField]) (*v2database.ListResult[*domain.Project], error) {
					gotOpts = opts
					return tc.result, tc.statementErr
				},
			})

			svc := service.NewProjectService(
				stubPool(),
				service.NewPool(mockPool),
				schemaRepo,
				flowDefinitionRepo,
				tokenGenerator,
				baseURL,
				schemaValidator,
			)

			resp, err := svc.List(context.Background(), tc.req)
			if tc.wantErr != nil {
				require.ErrorIs(t, err, tc.wantErr)
				return
			}
			require.NoError(t, err)
			if tc.checkOpts != nil {
				tc.checkOpts(t, gotOpts)
			}
			if tc.checkResp != nil {
				tc.checkResp(t, resp)
			}
		})
	}
}

func TestProjectService_List_ValidationErrors(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		req     service.ListProjectsRequest
		wantErr error
	}{
		{
			name: "unsupported operation not implemented",
			req: service.ListProjectsRequest{
				Filters: []service.Filter{{Field: "name", Operation: "not_equals", Value: "acme"}},
			},
			wantErr: domain.ErrNotImplemented(),
		},
		{
			name: "unknown field is invalid",
			req: service.ListProjectsRequest{
				Filters: []service.Filter{{Field: "bogus", Operation: "equals", Value: "x"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "unknown sort direction is invalid",
			req: service.ListProjectsRequest{
				Sorting: &service.Sorting{Field: "name", Direction: "sideways"},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "non-string name value is invalid",
			req: service.ListProjectsRequest{
				Filters: []service.Filter{{Field: "name", Operation: "equals", Value: 42}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "unparseable createdAt value is invalid",
			req: service.ListProjectsRequest{
				Filters: []service.Filter{{Field: "createdAt", Operation: "equals", Value: "not-a-time"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			ctrl := gomock.NewController(t)
			mockPool := servicemocks.NewMockPool(ctrl)
			schemaRepo := domainmock.NewMockJSONSchemaRepository(ctrl)
			flowDefinitionRepo := domainmock.NewMockFlowDefinitionRepository(ctrl)
			const baseURL = "https://example.com"
			schemaValidator, err := domain.NewSchemaValidator(baseURL)
			require.NoError(t, err)
			tokenGenerator := domainmock.NewMockTokenGenerator(ctrl)

			svc := service.NewProjectService(
				stubPool(),
				service.NewPool(mockPool),
				schemaRepo,
				flowDefinitionRepo,
				tokenGenerator,
				baseURL,
				schemaValidator,
			)

			_, err = svc.List(context.Background(), tc.req)
			require.ErrorIs(t, err, tc.wantErr)
		})
	}
}
