package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	idgenmock "github.com/zitadel/nextgen/internal/domain/idgen/idgenmock"
	domainmock "github.com/zitadel/nextgen/internal/domain/mock"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"go.uber.org/mock/gomock"
)

func TestProjectService_Create(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)

	tests := []struct {
		name           string
		previewOrigins []string
		setupRepo      func(*domainmock.MockProjectRepository)
		wantErr        bool
		check          func(t *testing.T, got *domain.Project)
	}{
		{
			name:           "ok — no preview origins",
			previewOrigins: nil,
			setupRepo: func(r *domainmock.MockProjectRepository) {
				r.EXPECT().
					Create(gomock.Any(), gomock.Any(), gomock.Any()).
					DoAndReturn(func(_ context.Context, _ database.QueryExecutor, p *domain.Project) error {
						assert.Equal(t, "proj_aaa", p.ID)
						assert.Equal(t, "sk_proj_bbb", p.ProjectSecret)
						assert.Equal(t, "sk_proj_ccc", p.PreviewSecret)
						return nil
					})
				r.EXPECT().
					Get(gomock.Any(), gomock.Any(), "proj_aaa").
					Return(&domain.Project{
						ID:             "proj_aaa",
						ProjectSecret:  "sk_proj_bbb",
						PreviewSecret:  "sk_proj_ccc",
						PreviewOrigins: []string{},
						CreatedAt:      now,
						UpdatedAt:      now,
					}, nil)
			},
			check: func(t *testing.T, got *domain.Project) {
				assert.Equal(t, "proj_aaa", got.ID)
				assert.Equal(t, "sk_proj_bbb", got.ProjectSecret)
				assert.Equal(t, "sk_proj_ccc", got.PreviewSecret)
			},
		},
		{
			name:           "ok — with preview origins",
			previewOrigins: []string{"*.vercel.app", "*.netlify.app"},
			setupRepo: func(r *domainmock.MockProjectRepository) {
				r.EXPECT().
					Create(gomock.Any(), gomock.Any(), gomock.Any()).
					DoAndReturn(func(_ context.Context, _ database.QueryExecutor, p *domain.Project) error {
						assert.Equal(t, []string{"*.vercel.app", "*.netlify.app"}, p.PreviewOrigins)
						return nil
					})
				r.EXPECT().
					Get(gomock.Any(), gomock.Any(), "proj_aaa").
					Return(&domain.Project{
						ID:             "proj_aaa",
						ProjectSecret:  "sk_proj_bbb",
						PreviewSecret:  "sk_proj_ccc",
						PreviewOrigins: []string{"*.vercel.app", "*.netlify.app"},
						CreatedAt:      now,
						UpdatedAt:      now,
					}, nil)
			},
			check: func(t *testing.T, got *domain.Project) {
				assert.Equal(t, []string{"*.vercel.app", "*.netlify.app"}, got.PreviewOrigins)
			},
		},
		{
			name:           "repo Create error",
			previewOrigins: nil,
			setupRepo: func(r *domainmock.MockProjectRepository) {
				r.EXPECT().
					Create(gomock.Any(), gomock.Any(), gomock.Any()).
					Return(errors.New("db error"))
			},
			wantErr: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctrl := gomock.NewController(t)
			ids := idgenmock.NewMockGenerator(ctrl)
			repo := domainmock.NewMockProjectRepository(ctrl)
			ids.EXPECT().New("proj").Return("proj_aaa", nil)
			ids.EXPECT().New("sk_proj").Return("sk_proj_bbb", nil)
			ids.EXPECT().New("sk_proj").Return("sk_proj_ccc", nil)
			tc.setupRepo(repo)

			svc := service.NewProjectService(stubPool(), repo, ids)
			got, err := svc.Create(context.Background(), tc.previewOrigins)

			require.Equal(t, tc.wantErr, err != nil)
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
			ids := idgenmock.NewMockGenerator(ctrl)
			repo := domainmock.NewMockProjectRepository(ctrl)
			tc.setupRepo(repo)

			svc := service.NewProjectService(stubPool(), repo, ids)
			got, err := svc.Get(context.Background(), tc.id)
			require.Equal(t, tc.wantErr, err != nil)
			if tc.check != nil {
				tc.check(t, got)
			}
		})
	}
}
