package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	cryptomock "github.com/zitadel/nextgen/internal/crypto/mock"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func createMockedProjectService(t *testing.T) (svc service.ProjectService,
	mock *gomock.Controller,
	db *service.DB,
	serverURL string,
	schemaValidator *domain.SchemaValidator,
	masterKey *cryptomock.MockCrypter,
	pool *servicemocks.MockPool,
	transaction *servicemocks.MockTransactioner[service.AllStatements],
	statementer *servicemocks.MockStatementer[service.AllStatements],
	statements *servicemocks.MockAllStatements,
) {
	t.Helper()

	mock = gomock.NewController(t)

	pool = servicemocks.NewMockPool(mock)
	masterKey = cryptomock.NewMockCrypter(mock)

	keyService := servicemocks.NewMockKeyService(mock)
	keyService.EXPECT().GetMasterKeyCrypter(gomock.Any()).Return(masterKey, nil).AnyTimes()

	transaction = servicemocks.NewMockTransactioner[service.AllStatements](mock)
	statementer = servicemocks.NewMockStatementer[service.AllStatements](mock)
	statements = servicemocks.NewMockAllStatements(mock)

	pool.EXPECT().Statements().Return(statements).AnyTimes()
	pool.EXPECT().
		Transaction(gomock.Any(), gomock.Any()).
		DoAndReturn(func(ctx context.Context, tx func(context.Context, service.Statementer[service.AllStatements]) error) error {
			return tx(ctx, statementer)
		}).
		AnyTimes()
	statementer.EXPECT().Statements().Return(statements).AnyTimes()
	statements.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()

	const baseURL = "https://example.com/api/schemas"

	db = service.NewPool(pool)
	schemaValidator, err := domain.NewSchemaValidator(baseURL)
	require.NoError(t, err)

	svc = service.NewProjectService(
		db,
		baseURL,
		schemaValidator,
		keyService,
	)

	return
}

func TestProjectService_Create(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name                   string
		projectName            string
		previewOrigins         []string
		seedDefaults           bool
		setupMocks             func(masterKey *cryptomock.MockCrypter, statements *servicemocks.MockAllStatements)
		wantErr                error
		expectedPreviewOrigins []string
	}{
		{
			name:           "ok — no preview origins",
			projectName:    "test",
			previewOrigins: nil,
			seedDefaults:   true,
			setupMocks: func(masterKey *cryptomock.MockCrypter, statements *servicemocks.MockAllStatements) {
				statements.EXPECT().CreateProject(gomock.Any(), gomock.Any()).DoAndReturn(
					func(_ context.Context, p *domain.Project) error {
						p.ID = "proj_generated"
						return nil
					},
				)
				masterKey.EXPECT().Encrypt(gomock.Any())
				masterKey.EXPECT().Decrypt(gomock.Any()).Return("thiskeyis32byteslongforsurerealy", nil)
				statements.EXPECT().NewManagedID(string(domain.PrefixEncryptionKey)).Return("enc_key_minted", nil)
				statements.EXPECT().CreateEncryptionKey(gomock.Any(), gomock.Any()).Times(4)
				statements.EXPECT().CreateSigningKey(gomock.Any(), gomock.Any()).Times(1)
				statements.EXPECT().CreateEnvironment(gomock.Any(), gomock.Any()).Times(len(domain.DefaultEnvironmentNames))
				statements.EXPECT().CreateAuthzAssignment(gomock.Any(), gomock.Any()).DoAndReturn(
					func(_ context.Context, a *domain.AuthzAssignment) error {
						assert.Equal(t, domain.AuthzPrincipalTypeSKProj, a.PrincipalType)
						assert.Equal(t, "proj_generated", a.PrincipalID)
						assert.Equal(t, "project", a.ObjectType)
						assert.Equal(t, "viewer", a.Relation)
						return nil
					},
				)
				statements.EXPECT().CreateJSONSchema(gomock.Any(), gomock.Any())
				statements.EXPECT().CreateFlowDefinition(gomock.Any(), gomock.Any())
			},
			expectedPreviewOrigins: make([]string, 0),
		},
		{
			name:           "ok — with preview origins",
			projectName:    "test",
			previewOrigins: []string{"*.vercel.app", "*.netlify.app"},
			seedDefaults:   true,
			setupMocks: func(masterKey *cryptomock.MockCrypter, statements *servicemocks.MockAllStatements) {
				statements.EXPECT().CreateProject(gomock.Any(), gomock.Any()).DoAndReturn(
					func(_ context.Context, p *domain.Project) error {
						p.ID = "proj_generated"
						return nil
					},
				)
				masterKey.EXPECT().Encrypt(gomock.Any())
				masterKey.EXPECT().Decrypt(gomock.Any()).Return("thiskeyis32byteslongforsurerealy", nil)
				statements.EXPECT().NewManagedID(string(domain.PrefixEncryptionKey)).Return("enc_key_minted", nil)
				statements.EXPECT().CreateEncryptionKey(gomock.Any(), gomock.Any()).Times(4)
				statements.EXPECT().CreateSigningKey(gomock.Any(), gomock.Any()).Times(1)
				// Environments are seeded for every project, seedDefaults or not.
				statements.EXPECT().CreateEnvironment(gomock.Any(), gomock.Any()).Times(len(domain.DefaultEnvironmentNames))
				statements.EXPECT().CreateAuthzAssignment(gomock.Any(), gomock.Any())
				statements.EXPECT().CreateJSONSchema(gomock.Any(), gomock.Any())
				statements.EXPECT().CreateFlowDefinition(gomock.Any(), gomock.Any())
			},
			expectedPreviewOrigins: []string{"*.vercel.app", "*.netlify.app"},
		},
		{
			name:         "ok — skip fallback defaults",
			projectName:  "test",
			seedDefaults: false,
			setupMocks: func(masterKey *cryptomock.MockCrypter, statements *servicemocks.MockAllStatements) {
				statements.EXPECT().CreateProject(gomock.Any(), gomock.Any()).DoAndReturn(
					func(_ context.Context, p *domain.Project) error {
						p.ID = "proj_generated"
						return nil
					},
				)
				masterKey.EXPECT().Encrypt(gomock.Any())
				masterKey.EXPECT().Decrypt(gomock.Any()).Return("thiskeyis32byteslongforsurerealy", nil)
				statements.EXPECT().NewManagedID(string(domain.PrefixEncryptionKey)).Return("enc_key_minted", nil)
				statements.EXPECT().CreateEncryptionKey(gomock.Any(), gomock.Any()).Times(4)
				statements.EXPECT().CreateSigningKey(gomock.Any(), gomock.Any()).Times(1)
				// Environments are seeded for every project, seedDefaults or not.
				statements.EXPECT().CreateEnvironment(gomock.Any(), gomock.Any()).Times(len(domain.DefaultEnvironmentNames))
				statements.EXPECT().CreateAuthzAssignment(gomock.Any(), gomock.Any())
				// No schema/flow-definition seeding when seedDefaults is false.
				statements.EXPECT().CreateJSONSchema(gomock.Any(), gomock.Any()).Times(0)
				statements.EXPECT().CreateFlowDefinition(gomock.Any(), gomock.Any()).Times(0)
			},
			expectedPreviewOrigins: make([]string, 0),
		},
		{
			name:        "project creation error should bubble up",
			projectName: "test",
			setupMocks: func(masterKey *cryptomock.MockCrypter, statements *servicemocks.MockAllStatements) {
				statements.EXPECT().CreateProject(gomock.Any(), gomock.Any()).Return(assert.AnError)
			},
			wantErr: domain.ErrInternal(assert.AnError),
		},
		{
			name:        "missing project name",
			projectName: "",
			setupMocks: func(*cryptomock.MockCrypter, *servicemocks.MockAllStatements) {
			},
			wantErr: domain.ErrProjectNameInvalid(),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			svc, _, _, _, _, masterKey, _, _, _, statements := createMockedProjectService(t)
			tc.setupMocks(masterKey, statements)

			got, err := svc.Create(context.Background(), tc.projectName, tc.previewOrigins, tc.seedDefaults)
			if tc.wantErr != nil {
				require.ErrorIs(t, err, tc.wantErr)
				assert.Nil(t, got)
				return
			}
			assert.NoError(t, err)
			if assert.NotNil(t, got) {
				assert.Equal(t, tc.expectedPreviewOrigins, got.PreviewOrigins)
			}
		})
	}
}

func TestProjectService_Get(t *testing.T) {
	t.Parallel()

	now := time.Now().UTC()
	project := &domain.Project{
		ID:             "proj_aaa",
		Name:           "project aaa",
		CreatedAt:      now,
		UpdatedAt:      now,
		PreviewOrigins: []string{"myapp.example.com"},
	}

	tests := []struct {
		name      string
		id        string
		setupStmt func(*servicemocks.MockAllStatements)
		wantErr   error
		want      *domain.Project
	}{
		{
			name: "ok",
			id:   "proj_aaa",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().GetProjectByID(gomock.Any(), "proj_aaa").Return(project, nil)
			},
			want: project,
		},
		{
			name: "not found",
			id:   "proj_aaa",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().GetProjectByID(gomock.Any(), "proj_aaa").Return(nil, database.NewNoRowFoundError(nil))
			},
			wantErr: database.NewNoRowFoundError(nil),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			svc, _, _, _, _, _, _, _, _, statements := createMockedProjectService(t)
			tc.setupStmt(statements)

			got, err := svc.Get(context.Background(), tc.id)
			if tc.wantErr != nil {
				require.ErrorIs(t, err, tc.wantErr)
				assert.Nil(t, got)
				return
			}
			assert.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestProjectService_Update(t *testing.T) {
	t.Parallel()

	createdAt := time.Now().UTC().Truncate(time.Second)
	updatedAt := createdAt.Add(time.Second)

	tests := []struct {
		name        string
		id          string
		projectName string
		setupStmt   func(*servicemocks.MockAllStatements)
		wantErr     error
		check       func(t *testing.T, got *domain.Project)
	}{
		{
			name:        "ok",
			id:          "proj_aaa",
			projectName: "updated project name",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().UpdateProject(gomock.Any(), gomock.Any()).DoAndReturn(
					func(_ context.Context, project *domain.Project) error {
						project.CreatedAt = createdAt
						project.UpdatedAt = updatedAt
						return nil
					})
			},
			check: func(t *testing.T, got *domain.Project) {
				assert.Equal(t, "proj_aaa", got.ID)
				assert.Equal(t, "updated project name", got.Name)
				assert.Equal(t, createdAt, got.CreatedAt)
				assert.Equal(t, updatedAt, got.UpdatedAt)
			},
		},
		{
			name:        "missing project id",
			id:          "",
			projectName: "updated project name",
			setupStmt:   func(*servicemocks.MockAllStatements) {},
			wantErr:     domain.ErrProjectMissingID(),
		},
		{
			name:        "project name is trimmed",
			id:          "proj_aaa",
			projectName: "  updated project name  ",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().UpdateProject(gomock.Any(), gomock.Any()).DoAndReturn(
					func(_ context.Context, project *domain.Project) error {
						project.CreatedAt = createdAt
						project.UpdatedAt = updatedAt
						return nil
					})
			},
			check: func(t *testing.T, got *domain.Project) {
				assert.Equal(t, "updated project name", got.Name)
			},
		},
		{
			name:        "missing project name",
			id:          "proj_aaa",
			projectName: "",
			setupStmt:   func(*servicemocks.MockAllStatements) {},
			wantErr:     domain.ErrProjectNameInvalid(),
		},
		{
			name:        "whitespace-only project name",
			id:          "proj_aaa",
			projectName: "   ",
			setupStmt:   func(*servicemocks.MockAllStatements) {},
			wantErr:     domain.ErrProjectNameInvalid(),
		},
		{
			name:        "not found",
			id:          "proj_missing",
			projectName: "updated project name",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().UpdateProject(gomock.Any(), gomock.Any()).
					Return(database.NewNoRowFoundError(nil))
			},
			wantErr: domain.ErrProjectNotFound(),
		},
		{
			name:        "update error",
			id:          "proj_aaa",
			projectName: "updated project name",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().UpdateProject(gomock.Any(), gomock.Any()).Return(assert.AnError)
			},
			wantErr: domain.ErrInternal(assert.AnError),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			svc, _, _, _, _, _, _, _, _, statements := createMockedProjectService(t)
			tc.setupStmt(statements)

			got, err := svc.Update(context.Background(), tc.id, tc.projectName)
			if tc.wantErr != nil {
				require.ErrorIs(t, err, tc.wantErr)
				assert.Nil(t, got)
				return
			}
			require.NoError(t, err)
			if tc.check != nil {
				tc.check(t, got)
			}
		})
	}
}

func TestProjectService_Delete(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		id        string
		setupStmt func(*servicemocks.MockAllStatements)
		wantErr   error
	}{
		{
			name: "ok",
			id:   "proj_aaa",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().DeleteProjectByID(gomock.Any(), "proj_aaa").Return(true, nil)
			},
		},
		{
			name: "unknown id skips emit",
			id:   "proj_aaa",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().DeleteProjectByID(gomock.Any(), "proj_aaa").Return(false, nil)
				// InsertEvent must not be required.
			},
		},
		{
			name: "delete failed",
			id:   "proj_aaa",
			setupStmt: func(s *servicemocks.MockAllStatements) {
				s.EXPECT().DeleteProjectByID(gomock.Any(), "proj_aaa").Return(false, assert.AnError)
			},
			wantErr: domain.ErrInternal(assert.AnError),
		},
		{
			name:      "missing project id",
			id:        "",
			setupStmt: func(*servicemocks.MockAllStatements) {},
			wantErr:   domain.ErrProjectMissingID(),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			svc, _, _, _, _, _, _, _, _, statements := createMockedProjectService(t)
			tc.setupStmt(statements)

			err := svc.Delete(context.Background(), tc.id)
			if tc.wantErr != nil {
				require.ErrorIs(t, err, tc.wantErr)
				return
			}
			require.NoError(t, err)
		})
	}
}

func TestProjectService_List(t *testing.T) {
	t.Parallel()

	createdAt := time.Now().UTC().Truncate(time.Second)

	tests := []struct {
		name         string
		req          service.ListProjectsRequest
		result       *database.ListResult[*domain.Project]
		statementErr error
		wantErr      error
		checkOpts    func(t *testing.T, opts *database.ListOptions[domain.ProjectField])
		checkResp    func(t *testing.T, resp *service.ListProjectsResponse)
	}{
		{
			name: "defaults",
			req:  service.ListProjectsRequest{ProjectID: "proj_a"},
			result: &database.ListResult[*domain.Project]{
				Items:      []*domain.Project{{ID: "proj_a"}, {ID: "proj_b"}},
				NextCursor: []byte("next"),
			},
			checkOpts: func(t *testing.T, opts *database.ListOptions[domain.ProjectField]) {
				assert.Equal(t, uint32(20), opts.Pagination.Limit)
				assert.Nil(t, opts.Pagination.Cursor)
				assert.Equal(t, database.OrderAsc, opts.Pagination.OrderBy.Direction)
				assert.Equal(t, []database.Column[domain.ProjectField]{
					database.Col(domain.ProjectFieldCreatedAt),
					database.Col(domain.ProjectFieldID),
				}, opts.Pagination.OrderBy.Columns)
				assert.Equal(t, database.And(
					database.Equal(database.Col(domain.ProjectFieldID), "proj_a"),
				), opts.Filter)
			},
			checkResp: func(t *testing.T, resp *service.ListProjectsResponse) {
				assert.Len(t, resp.Projects, 2)
				assert.Equal(t, "next", resp.NextPageToken)
			},
		},
		{
			name:   "limit clamped to max",
			req:    service.ListProjectsRequest{ProjectID: "proj_a", Limit: 500},
			result: &database.ListResult[*domain.Project]{},
			checkOpts: func(t *testing.T, opts *database.ListOptions[domain.ProjectField]) {
				assert.Equal(t, uint32(100), opts.Pagination.Limit)
			},
		},
		{
			name:   "negative limit uses default",
			req:    service.ListProjectsRequest{ProjectID: "proj_a", Limit: -5},
			result: &database.ListResult[*domain.Project]{},
			checkOpts: func(t *testing.T, opts *database.ListOptions[domain.ProjectField]) {
				assert.Equal(t, uint32(20), opts.Pagination.Limit)
			},
		},
		{
			name:   "zero limit uses default, not storage's no-limit",
			req:    service.ListProjectsRequest{ProjectID: "proj_a", Limit: 0},
			result: &database.ListResult[*domain.Project]{},
			checkOpts: func(t *testing.T, opts *database.ListOptions[domain.ProjectField]) {
				assert.Equal(t, uint32(20), opts.Pagination.Limit)
			},
		},
		{
			name: "project id restricts results to that project",
			req:  service.ListProjectsRequest{ProjectID: "proj_a"},
			result: &database.ListResult[*domain.Project]{
				Items: []*domain.Project{{ID: "proj_a"}},
			},
			checkOpts: func(t *testing.T, opts *database.ListOptions[domain.ProjectField]) {
				assert.Equal(t, database.And(
					database.Equal(database.Col(domain.ProjectFieldID), "proj_a"),
				), opts.Filter)
			},
		},
		{
			name: "sort by createdAt desc",
			req: service.ListProjectsRequest{
				ProjectID: "proj_a",
				Sorting:   &service.Sorting{Field: "created_at", Direction: "desc"},
			},
			result: &database.ListResult[*domain.Project]{},
			checkOpts: func(t *testing.T, opts *database.ListOptions[domain.ProjectField]) {
				assert.Equal(t, database.OrderDesc, opts.Pagination.OrderBy.Direction)
				assert.Equal(t, []database.Column[domain.ProjectField]{
					database.Col(domain.ProjectFieldCreatedAt),
					database.Col(domain.ProjectFieldID),
				}, opts.Pagination.OrderBy.Columns)
			},
		},
		{
			name: "filter equals createdAt",
			req: service.ListProjectsRequest{
				ProjectID: "proj_a",
				Filters:   []service.Filter{{Field: "created_at", Operation: "equals", Value: createdAt.Format(time.RFC3339)}},
			},
			result: &database.ListResult[*domain.Project]{},
			checkOpts: func(t *testing.T, opts *database.ListOptions[domain.ProjectField]) {
				assert.Equal(t, database.And(
					database.Equal(database.Col(domain.ProjectFieldID), "proj_a"),
					database.Equal(database.Col(domain.ProjectFieldCreatedAt), createdAt),
				), opts.Filter)
			},
		},
		{
			name: "filter greater_than createdAt parses RFC3339",
			req: service.ListProjectsRequest{
				ProjectID: "proj_a",
				Filters:   []service.Filter{{Field: "created_at", Operation: "greater_than", Value: createdAt.Format(time.RFC3339)}},
			},
			result: &database.ListResult[*domain.Project]{},
			checkOpts: func(t *testing.T, opts *database.ListOptions[domain.ProjectField]) {
				assert.Equal(t, database.And(
					database.Equal(database.Col(domain.ProjectFieldID), "proj_a"),
					database.GreaterThan(database.Col(domain.ProjectFieldCreatedAt), createdAt),
				), opts.Filter)
			},
		},
		{
			name: "createdAt range filter ANDs both bounds",
			req: service.ListProjectsRequest{
				ProjectID: "proj_a",
				Filters: []service.Filter{
					{Field: "created_at", Operation: "greater_than", Value: createdAt.Format(time.RFC3339)},
					{Field: "created_at", Operation: "less_than", Value: createdAt.Add(time.Hour).Format(time.RFC3339)},
				},
			},
			result: &database.ListResult[*domain.Project]{},
			checkOpts: func(t *testing.T, opts *database.ListOptions[domain.ProjectField]) {
				assert.Equal(t, database.And(
					database.Equal(database.Col(domain.ProjectFieldID), "proj_a"),
					database.GreaterThan(database.Col(domain.ProjectFieldCreatedAt), createdAt),
					database.LessThan(database.Col(domain.ProjectFieldCreatedAt), createdAt.Add(time.Hour)),
				), opts.Filter)
			},
		},
		{
			name:   "page token passed through as cursor",
			req:    service.ListProjectsRequest{ProjectID: "proj_a", PageToken: "tok"},
			result: &database.ListResult[*domain.Project]{},
			checkOpts: func(t *testing.T, opts *database.ListOptions[domain.ProjectField]) {
				assert.Equal(t, []byte("tok"), opts.Pagination.Cursor)
			},
		},
		{
			name:         "statement error is wrapped",
			req:          service.ListProjectsRequest{ProjectID: "proj_a"},
			statementErr: assert.AnError,
			wantErr:      domain.ErrInternal(assert.AnError),
		},
		{
			name:         "invalid cursor maps to request invalid",
			req:          service.ListProjectsRequest{ProjectID: "proj_a", PageToken: "bad"},
			statementErr: database.ErrInvalidCursor(),
			wantErr:      domain.ErrRequestInvalid(),
		},
		{
			name:         "cursor order mismatch maps to request invalid",
			req:          service.ListProjectsRequest{ProjectID: "proj_a", PageToken: "bad"},
			statementErr: database.ErrCursorOrderMismatch(),
			wantErr:      domain.ErrRequestInvalid(),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			svc, _, _, _, _, _, _, _, _, statements := createMockedProjectService(t)

			var gotOpts *database.ListOptions[domain.ProjectField]
			statements.EXPECT().ListProjects(gomock.Any(), gomock.Any()).DoAndReturn(
				func(_ context.Context, opts *database.ListOptions[domain.ProjectField]) (*database.ListResult[*domain.Project], error) {
					gotOpts = opts
					return tc.result, tc.statementErr
				})

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
			name:    "missing project id is refused",
			req:     service.ListProjectsRequest{},
			wantErr: domain.ErrProjectMissingID(),
		},
		{
			name: "unsupported operation not implemented",
			req: service.ListProjectsRequest{
				ProjectID: "proj_a",
				Filters:   []service.Filter{{Field: "created_at", Operation: "not_equals", Value: time.Now().UTC().Format(time.RFC3339)}},
			},
			wantErr: domain.ErrNotImplemented(),
		},
		{
			name: "unknown field is invalid",
			req: service.ListProjectsRequest{
				ProjectID: "proj_a",
				Filters:   []service.Filter{{Field: "name", Operation: "equals", Value: "x"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "unknown sort direction is invalid",
			req: service.ListProjectsRequest{
				ProjectID: "proj_a",
				Sorting:   &service.Sorting{Field: "created_at", Direction: "sideways"},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "non-string createdAt value is invalid",
			req: service.ListProjectsRequest{
				ProjectID: "proj_a",
				Filters:   []service.Filter{{Field: "created_at", Operation: "equals", Value: 42}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
		{
			name: "unparseable createdAt value is invalid",
			req: service.ListProjectsRequest{
				ProjectID: "proj_a",
				Filters:   []service.Filter{{Field: "created_at", Operation: "equals", Value: "not-a-time"}},
			},
			wantErr: domain.ErrRequestInvalid(),
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			// The statement must never be reached: validation fails first, so no
			// ListProjects expectation is set and gomock would flag an unexpected call.
			svc, _, _, _, _, _, _, _, _, _ := createMockedProjectService(t)

			_, err := svc.List(context.Background(), tc.req)
			require.ErrorIs(t, err, tc.wantErr)
		})
	}
}

func TestProjectService_DefaultProject(t *testing.T) {
	t.Parallel()

	t.Run("resolves the first-created project when nothing is configured", func(t *testing.T) {
		t.Parallel()

		first := &domain.Project{
			ID:             "proj_first",
			CreatedAt:      time.Now().UTC(),
			UpdatedAt:      time.Now().UTC(),
			PreviewOrigins: []string{},
		}

		svc, _, _, _, _, _, _, _, _, statements := createMockedProjectService(t)

		statements.EXPECT().
			ListProjects(gomock.Any(), gomock.Any()).
			DoAndReturn(func(_ context.Context, opts *database.ListOptions[domain.ProjectField]) (*database.ListResult[*domain.Project], error) {
				// Two candidates, because the earliest row may be the platform
				// project the heuristic must skip.
				assert.EqualValues(t, 2, opts.Pagination.Limit)
				assert.Equal(t, []database.Column[domain.ProjectField]{database.Col(domain.ProjectFieldCreatedAt)}, opts.Pagination.OrderBy.Columns)
				assert.Equal(t, database.OrderAsc, opts.Pagination.OrderBy.Direction)
				return &database.ListResult[*domain.Project]{Items: []*domain.Project{first}}, nil
			})

		got, err := svc.DefaultProject(context.Background(), "")

		assert.NoError(t, err)
		assert.Equal(t, first, got)
	})

	// A bootstrapped deployment (CLI-managed local servers seed the platform
	// project at startup, before any user project exists) must still resolve
	// the user's own project: the platform row is infrastructure, not the
	// deployment's product.
	t.Run("skips the platform project even when it is the oldest row", func(t *testing.T) {
		t.Parallel()

		platform := &domain.Project{ID: domain.PlatformProjectID, PreviewOrigins: []string{}}
		real := &domain.Project{ID: "proj_real", PreviewOrigins: []string{}}

		svc, _, _, _, _, _, _, _, _, statements := createMockedProjectService(t)

		statements.EXPECT().
			ListProjects(gomock.Any(), gomock.Any()).
			Return(&database.ListResult[*domain.Project]{Items: []*domain.Project{platform, real}}, nil)

		got, err := svc.DefaultProject(context.Background(), "")

		assert.NoError(t, err)
		assert.Equal(t, real, got)
	})

	t.Run("returns nil when only the platform project exists", func(t *testing.T) {
		t.Parallel()

		platform := &domain.Project{ID: domain.PlatformProjectID, PreviewOrigins: []string{}}

		svc, _, _, _, _, _, _, _, _, statements := createMockedProjectService(t)

		statements.EXPECT().
			ListProjects(gomock.Any(), gomock.Any()).
			Return(&database.ListResult[*domain.Project]{Items: []*domain.Project{platform}}, nil)

		got, err := svc.DefaultProject(context.Background(), "")

		assert.NoError(t, err)
		assert.Nil(t, got)
	})

	// Explicit configuration wins unchanged, including pointing at the
	// platform project itself.
	t.Run("a configured platform project id is honored", func(t *testing.T) {
		t.Parallel()

		platform := &domain.Project{ID: domain.PlatformProjectID, PreviewOrigins: []string{}}

		svc, _, _, _, _, _, _, _, _, statements := createMockedProjectService(t)

		statements.EXPECT().GetProjectByID(gomock.Any(), domain.PlatformProjectID).Return(platform, nil)
		statements.EXPECT().ListProjects(gomock.Any(), gomock.Any()).Times(0)

		got, err := svc.DefaultProject(context.Background(), domain.PlatformProjectID)

		assert.NoError(t, err)
		assert.Equal(t, platform, got)
	})

	t.Run("returns nil while no project exists yet — the server never creates one", func(t *testing.T) {
		t.Parallel()

		svc, _, _, _, _, _, _, _, _, statements := createMockedProjectService(t)

		statements.EXPECT().
			ListProjects(gomock.Any(), gomock.Any()).
			Return(&database.ListResult[*domain.Project]{}, nil)
		statements.EXPECT().CreateProject(gomock.Any(), gomock.Any()).Times(0)

		got, err := svc.DefaultProject(context.Background(), "")

		assert.NoError(t, err)
		assert.Nil(t, got)
	})

	t.Run("returns the configured project when it exists", func(t *testing.T) {
		t.Parallel()

		configured := &domain.Project{ID: "proj_custom", PreviewOrigins: []string{}}

		svc, _, _, _, _, _, _, _, _, statements := createMockedProjectService(t)

		statements.EXPECT().GetProjectByID(gomock.Any(), "proj_custom").Return(configured, nil)
		statements.EXPECT().ListProjects(gomock.Any(), gomock.Any()).Times(0)

		got, err := svc.DefaultProject(context.Background(), "proj_custom")

		assert.NoError(t, err)
		assert.Equal(t, configured, got)
	})

	t.Run("a configured but missing project is a configuration error", func(t *testing.T) {
		t.Parallel()

		svc, _, _, _, _, _, _, _, _, statements := createMockedProjectService(t)

		statements.EXPECT().
			GetProjectByID(gomock.Any(), "proj_gone").
			Return(nil, database.NewNoRowFoundError(errors.New("no rows")))
		statements.EXPECT().ListProjects(gomock.Any(), gomock.Any()).Times(0)

		got, err := svc.DefaultProject(context.Background(), "proj_gone")

		assert.Nil(t, got)
		var de domain.Error
		require.ErrorAs(t, err, &de)
		assert.Equal(t, domain.ErrProjectNotFound().Code, de.Code)
	})
}
