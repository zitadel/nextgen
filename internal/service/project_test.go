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
	"github.com/zitadel/nextgen/internal/secrets"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/database/dbmock"
	"go.uber.org/mock/gomock"
)

func TestProjectService_Create(t *testing.T) {
	tests := []struct {
		name                    string
		previewOrigins          []string
		setupProjectRepo        func(*domainmock.MockProjectRepository)
		setupSchemaRepo         func(*domainmock.MockJSONSchemaRepository)
		setupFlowDefinitionRepo func(call *domainmock.MockFlowDefinitionRepository)
		setupPool               func(*dbmock.MockPool, *dbmock.MockTransaction)
		wantErr                 bool
		check                   func(t *testing.T, got *domain.Project)
	}{
		{
			name:           "ok — no preview origins",
			previewOrigins: nil,
			setupProjectRepo: func(r *domainmock.MockProjectRepository) {
				r.EXPECT().
					Create(gomock.Any(), gomock.Any(), gomock.Any()).
					DoAndReturn(func(_ context.Context, _ database.QueryExecutor, p *domain.Project) error {
						return nil
					})
			},
			setupSchemaRepo: func(r *domainmock.MockJSONSchemaRepository) {
				r.EXPECT().Create(gomock.Any(), gomock.Any(), gomock.Any())
			},
			setupFlowDefinitionRepo: func(r *domainmock.MockFlowDefinitionRepository) {
				r.EXPECT().CreateFlowDefinition(gomock.Any(), gomock.Any(), gomock.Any())
			},
			setupPool: func(pool *dbmock.MockPool, transaction *dbmock.MockTransaction) {
				pool.EXPECT().Begin(gomock.Any(), gomock.Any()).Return(transaction, nil)
				transaction.EXPECT().Commit(gomock.Any())
			},
			check: func(t *testing.T, got *domain.Project) {
				assert.NotNil(t, got)
			},
		},
		{
			name:           "ok — with preview origins",
			previewOrigins: []string{"*.vercel.app", "*.netlify.app"},
			setupProjectRepo: func(r *domainmock.MockProjectRepository) {
				r.EXPECT().
					Create(gomock.Any(), gomock.Any(), gomock.Any()).
					DoAndReturn(func(_ context.Context, _ database.QueryExecutor, p *domain.Project) error {
						assert.Equal(t, []string{"*.vercel.app", "*.netlify.app"}, p.PreviewOrigins)
						return nil
					})
			},
			setupSchemaRepo: func(r *domainmock.MockJSONSchemaRepository) {
				r.EXPECT().Create(gomock.Any(), gomock.Any(), gomock.Any())
			},
			setupFlowDefinitionRepo: func(r *domainmock.MockFlowDefinitionRepository) {
				r.EXPECT().CreateFlowDefinition(gomock.Any(), gomock.Any(), gomock.Any())
			},
			setupPool: func(pool *dbmock.MockPool, transaction *dbmock.MockTransaction) {
				pool.EXPECT().Begin(gomock.Any(), gomock.Any()).Return(transaction, nil)
				transaction.EXPECT().Commit(gomock.Any())
			},
			check: func(t *testing.T, got *domain.Project) {
				assert.Equal(t, []string{"*.vercel.app", "*.netlify.app"}, got.PreviewOrigins)
			},
		},
		{
			name:           "repo Create error",
			previewOrigins: nil,
			setupProjectRepo: func(r *domainmock.MockProjectRepository) {
				r.EXPECT().
					Create(gomock.Any(), gomock.Any(), gomock.Any()).
					Return(errors.New("db error"))
			},
			setupPool: func(pool *dbmock.MockPool, transaction *dbmock.MockTransaction) {
				pool.EXPECT().Begin(gomock.Any(), gomock.Any()).Return(transaction, nil)
				transaction.EXPECT().Rollback(gomock.Any())
			},
			wantErr: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			pool := dbmock.NewMockPool(ctrl)
			transaction := dbmock.NewMockTransaction(ctrl)
			projectRepo := domainmock.NewMockProjectRepository(ctrl)
			schemaRepo := domainmock.NewMockJSONSchemaRepository(ctrl)
			flowDefinitionRepo := domainmock.NewMockFlowDefinitionRepository(ctrl)
			const baseURL = "https://example.com/api/schemas"
			schemaValidator, err := domain.NewSchemaValidator(baseURL)

			tc.setupProjectRepo(projectRepo)
			if tc.setupSchemaRepo != nil {
				tc.setupSchemaRepo(schemaRepo)
			}
			if tc.setupFlowDefinitionRepo != nil {
				tc.setupFlowDefinitionRepo(flowDefinitionRepo)
			}
			if tc.setupPool != nil {
				tc.setupPool(pool, transaction)
			}

			svc := service.NewProjectService(
				pool,
				projectRepo,
				schemaRepo,
				flowDefinitionRepo,
				&secrets.RandomSecretGenerator{},
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
		name      string
		id        string
		setupRepo func(*domainmock.MockProjectRepository)
		wantErr   bool
		check     func(t *testing.T, got *domain.Project)
	}{
		{
			name: "ok",
			id:   "proj_aaa",
			setupRepo: func(r *domainmock.MockProjectRepository) {
				r.EXPECT().
					Get(gomock.Any(), gomock.Any(), "proj_aaa").
					Return(&domain.Project{
						ID:        "proj_aaa",
						CreatedAt: now,
						UpdatedAt: now,
					}, nil)
			},
			check: func(t *testing.T, got *domain.Project) {
				assert.Equal(t, "proj_aaa", got.ID)
				assert.False(t, got.CreatedAt.IsZero())
			},
		},
		{
			name: "not found",
			id:   "proj_missing",
			setupRepo: func(r *domainmock.MockProjectRepository) {
				r.EXPECT().
					Get(gomock.Any(), gomock.Any(), "proj_missing").
					Return(nil, database.NewNoRowFoundError(nil))
			},
			wantErr: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			projectRepo := domainmock.NewMockProjectRepository(ctrl)
			schemaRepo := domainmock.NewMockJSONSchemaRepository(ctrl)
			flowDefinitionRepo := domainmock.NewMockFlowDefinitionRepository(ctrl)
			const baseURL = "https://example.com"
			schemaValidator, err := domain.NewSchemaValidator(baseURL)
			tc.setupRepo(projectRepo)

			svc := service.NewProjectService(
				stubPool(),
				projectRepo,
				schemaRepo,
				flowDefinitionRepo,
				&secrets.RandomSecretGenerator{},
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
