package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	cryptomock "github.com/zitadel/nextgen/internal/crypto/mock"
	"github.com/zitadel/nextgen/internal/domain"
	domainmock "github.com/zitadel/nextgen/internal/domain/mock"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
	v2db "github.com/zitadel/nextgen/internal/storage/v2/database"
	"go.uber.org/mock/gomock"
)

func createMockedProjectService(t *testing.T) (svc service.ProjectService,
	mock *gomock.Controller,
	db *service.DB,
	schemaRepo *domainmock.MockJSONSchemaRepository,
	flowDefinitionRepo *domainmock.MockFlowDefinitionRepository,
	serverURL string,
	schemaValidator *domain.SchemaValidator,
	kek *cryptomock.MockCrypter,
	pool *servicemocks.MockPool,
	transaction *servicemocks.MockTransactioner[service.AllStatements],
	statementer *servicemocks.MockStatementerWithQueryExecutor[service.AllStatements],
	statements *servicemocks.MockAllStatements,
) {
	t.Helper()

	mock = gomock.NewController(t)

	pool = servicemocks.NewMockPool(mock)
	schemaRepo = domainmock.NewMockJSONSchemaRepository(mock)
	flowDefinitionRepo = domainmock.NewMockFlowDefinitionRepository(mock)
	kek = cryptomock.NewMockCrypter(mock)

	keyService := servicemocks.NewMockKeyService(mock)
	keyService.EXPECT().GetKekCrypter(gomock.Any()).Return(kek, nil).AnyTimes()

	transaction = servicemocks.NewMockTransactioner[service.AllStatements](mock)
	statementer = servicemocks.NewMockStatementerWithQueryExecutor[service.AllStatements](mock)
	statements = servicemocks.NewMockAllStatements(mock)

	pool.EXPECT().Statements().Return(statements).AnyTimes()
	pool.EXPECT().
		Transaction(gomock.Any(), gomock.Any()).
		DoAndReturn(func(ctx context.Context, tx func(context.Context, service.Statementer[service.AllStatements]) error) error {
			return tx(ctx, statementer)
		}).
		AnyTimes()
	statementer.EXPECT().Statements().Return(statements).AnyTimes()

	const baseURL = "https://example.com/api/schemas"

	db = service.NewPool(pool)
	schemaValidator, err := domain.NewSchemaValidator(baseURL)
	require.NoError(t, err)

	svc = service.NewProjectService(
		db,
		schemaRepo,
		flowDefinitionRepo,
		baseURL,
		schemaValidator,
		keyService,
	)

	return
}

func TestProjectService_Create(t *testing.T) {
	t.Parallel()

	t.Run("ok", func(t *testing.T) {
		t.Parallel()

		tcs := []struct {
			name                   string
			projectName            string
			previewOrigins         []string
			seedDefaults           bool
			expectedPreviewOrigins []string
		}{
			{
				name:                   "ok — no preview origins",
				projectName:            "test",
				previewOrigins:         nil,
				seedDefaults:           true,
				expectedPreviewOrigins: make([]string, 0),
			},
			{
				name:                   "ok — with preview origins",
				projectName:            "test",
				previewOrigins:         []string{"*.vercel.app", "*.netlify.app"},
				seedDefaults:           true,
				expectedPreviewOrigins: []string{"*.vercel.app", "*.netlify.app"},
			},
		}

		for _, tc := range tcs {
			t.Run(tc.name, func(t *testing.T) {
				t.Parallel()

				svc, _, _, schemaRepo, definitionRepo, _, _, kek, _, _, _, statements := createMockedProjectService(t)

				kek.EXPECT().Encrypt(gomock.Any())
				statements.EXPECT().CreateProject(gomock.Any(), gomock.Any())
				statements.EXPECT().CreateEncryptionKey(gomock.Any(), gomock.Any())
				schemaRepo.EXPECT().Create(gomock.Any(), gomock.Any(), gomock.Any())
				definitionRepo.EXPECT().CreateFlowDefinition(gomock.Any(), gomock.Any(), gomock.Any())

				got, err := svc.Create(context.Background(), tc.projectName, tc.previewOrigins, tc.seedDefaults)

				assert.NoError(t, err)
				if assert.NotNil(t, got) {
					assert.Equal(t, tc.expectedPreviewOrigins, got.PreviewOrigins)
				}
			})
		}

		t.Run("ok — skip fallback defaults", func(t *testing.T) {
			t.Parallel()

			svc, _, _, schemaRepo, definitionRepo, _, _, kek, _, _, _, statements := createMockedProjectService(t)

			kek.EXPECT().Encrypt(gomock.Any())
			statements.EXPECT().CreateProject(gomock.Any(), gomock.Any())
			statements.EXPECT().CreateEncryptionKey(gomock.Any(), gomock.Any())

			schemaRepo.EXPECT().Create(gomock.Any(), gomock.Any(), gomock.Any()).Times(0)
			definitionRepo.EXPECT().CreateFlowDefinition(gomock.Any(), gomock.Any(), gomock.Any()).Times(0)

			_, err := svc.Create(context.Background(), "test", nil, false)
			assert.NoError(t, err)
		})
	})

	t.Run("error", func(t *testing.T) {
		t.Parallel()

		t.Run("project creation error should bubble up", func(t *testing.T) {
			t.Parallel()

			svc, _, _, _, _, _, _, kek, _, _, _, statements := createMockedProjectService(t)

			kek.EXPECT().Encrypt(gomock.Any())
			statements.EXPECT().CreateProject(gomock.Any(), gomock.Any()).Return(errors.New("db error"))

			got, err := svc.Create(context.Background(), "test", nil, false)

			assert.Nil(t, got)
			assert.Error(t, err)
		})

		t.Run("missing project name", func(t *testing.T) {
			t.Parallel()

			svc, _, _, _, _, _, _, _, _, _, _, _ := createMockedProjectService(t)

			got, err := svc.Create(context.Background(), "", nil, false)

			assert.Nil(t, got)
			assert.Error(t, err)
		})
	})
}

func TestProjectService_Get(t *testing.T) {
	t.Parallel()

	t.Run("ok", func(t *testing.T) {
		t.Parallel()

		projectID := "proj_aaa"
		project := &domain.Project{
			ID:             projectID,
			Name:           "project aaa",
			CreatedAt:      time.Now().UTC(),
			UpdatedAt:      time.Now().UTC(),
			PreviewOrigins: []string{"myapp.example.com"},
		}

		svc, _, _, _, _, _, _, _, _, _, _, statements := createMockedProjectService(t)

		statements.EXPECT().GetProjectByID(gomock.Any(), projectID).Return(project, nil)

		got, err := svc.Get(context.Background(), projectID)
		assert.NoError(t, err)
		assert.Equal(t, got, project)
	})

	t.Run("error", func(t *testing.T) {
		t.Parallel()

		t.Run("not found", func(t *testing.T) {
			t.Parallel()

			projectID := "proj_aaa"

			svc, _, _, _, _, _, _, _, _, _, _, statements := createMockedProjectService(t)

			statements.EXPECT().GetProjectByID(gomock.Any(), projectID).Return(nil, database.NewNoRowFoundError(nil))

			got, err := svc.Get(context.Background(), projectID)
			assert.Nil(t, got)
			assert.Error(t, err)
		})
	})
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

		svc, _, _, _, _, _, _, _, _, _, _, statements := createMockedProjectService(t)

		statements.EXPECT().
			ListProjects(gomock.Any(), gomock.Any()).
			DoAndReturn(func(_ context.Context, opts *v2db.ListOptions[domain.ProjectField]) (*v2db.ListResult[*domain.Project], error) {
				assert.EqualValues(t, 1, opts.Pagination.Limit)
				assert.Equal(t, v2db.OrderAsc, opts.Pagination.OrderBy.Direction)
				return &v2db.ListResult[*domain.Project]{Items: []*domain.Project{first}}, nil
			})

		got, err := svc.DefaultProject(context.Background(), "")

		assert.NoError(t, err)
		assert.Equal(t, first, got)
	})

	t.Run("returns nil while no project exists yet — the server never creates one", func(t *testing.T) {
		t.Parallel()

		svc, _, _, _, _, _, _, _, _, _, _, statements := createMockedProjectService(t)

		statements.EXPECT().
			ListProjects(gomock.Any(), gomock.Any()).
			Return(&v2db.ListResult[*domain.Project]{}, nil)
		statements.EXPECT().CreateProject(gomock.Any(), gomock.Any()).Times(0)

		got, err := svc.DefaultProject(context.Background(), "")

		assert.NoError(t, err)
		assert.Nil(t, got)
	})

	t.Run("returns the configured project when it exists", func(t *testing.T) {
		t.Parallel()

		configured := &domain.Project{ID: "proj_custom", PreviewOrigins: []string{}}

		svc, _, _, _, _, _, _, _, _, _, _, statements := createMockedProjectService(t)

		statements.EXPECT().GetProjectByID(gomock.Any(), "proj_custom").Return(configured, nil)
		statements.EXPECT().ListProjects(gomock.Any(), gomock.Any()).Times(0)

		got, err := svc.DefaultProject(context.Background(), "proj_custom")

		assert.NoError(t, err)
		assert.Equal(t, configured, got)
	})

	t.Run("a configured but missing project is a configuration error", func(t *testing.T) {
		t.Parallel()

		svc, _, _, _, _, _, _, _, _, _, _, statements := createMockedProjectService(t)

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
