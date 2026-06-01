package service_test

import (
	"context"
	"errors"
	"fmt"
	"sync"
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

func TestProjectService_ApplyConfigRejectsWrongProjectSecret(t *testing.T) {
	ctrl := gomock.NewController(t)
	ids := idgenmock.NewMockGenerator(ctrl)
	repo := domainmock.NewMockProjectRepository(ctrl)
	repo.EXPECT().
		Get(gomock.Any(), gomock.Any(), "proj_aaa").
		Return(&domain.Project{
			ID:            "proj_aaa",
			ProjectSecret: "sk_proj_old",
			Lifecycle:     domain.ProjectLifecycleUnclaimed,
		}, nil)

	svc := service.NewProjectService(stubPool(), repo, ids)
	got, err := svc.ApplyConfig(context.Background(), service.ApplyProjectConfigInput{
		ProjectID:     "proj_aaa",
		ProjectSecret: "sk_proj_wrong",
		Environment:   service.ProjectEnvironmentPreview,
	})

	require.Nil(t, got)
	require.ErrorIs(t, err, domain.ErrAuthUnauthorized(nil))
}

func TestProjectService_ApplyConfigRequiresClaimForPreview(t *testing.T) {
	ctrl := gomock.NewController(t)
	ids := idgenmock.NewMockGenerator(ctrl)
	repo := domainmock.NewMockProjectRepository(ctrl)
	repo.EXPECT().
		Get(gomock.Any(), gomock.Any(), "proj_aaa").
		Return(&domain.Project{
			ID:            "proj_aaa",
			ProjectSecret: "sk_proj_old",
			Lifecycle:     domain.ProjectLifecycleUnclaimed,
		}, nil)

	svc := service.NewProjectService(stubPool(), repo, ids)
	got, err := svc.ApplyConfig(context.Background(), service.ApplyProjectConfigInput{
		ProjectID:     "proj_aaa",
		ProjectSecret: "sk_proj_old",
		Environment:   service.ProjectEnvironmentPreview,
	})

	require.Nil(t, got)
	require.ErrorIs(t, err, domain.ErrProjectClaimRequired())
}

func TestProjectService_CreateWithIdempotencySerializesConcurrentCreates(t *testing.T) {
	repo := newFakeProjectRepository()
	repo.createDelay = 20 * time.Millisecond
	ids := &sequenceIDGenerator{}
	svc := service.NewProjectService(stubPool(), repo, ids)

	const workers = 8
	start := make(chan struct{})
	results := make(chan *domain.Project, workers)
	errs := make(chan error, workers)
	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			project, err := svc.CreateWithIdempotency(context.Background(), []string{"*.vercel.app"}, "same-key")
			if err != nil {
				errs <- err
				return
			}
			results <- project
		}()
	}

	close(start)
	wg.Wait()
	close(results)
	close(errs)

	require.Empty(t, errs)
	require.Equal(t, 1, repo.createCountValue())
	var projectID string
	for project := range results {
		require.NotNil(t, project)
		if projectID == "" {
			projectID = project.ID
		}
		assert.Equal(t, projectID, project.ID)
	}
}

func TestProjectService_ClaimLifecycleReturnsRotatedSecretOnce(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	ctrl := gomock.NewController(t)
	ids := idgenmock.NewMockGenerator(ctrl)
	repo := domainmock.NewMockProjectRepository(ctrl)

	repo.EXPECT().
		Get(gomock.Any(), gomock.Any(), "proj_aaa").
		Return(&domain.Project{
			ID:            "proj_aaa",
			ProjectSecret: "sk_proj_old",
			Lifecycle:     domain.ProjectLifecycleUnclaimed,
			CreatedAt:     now,
			UpdatedAt:     now,
		}, nil)
	ids.EXPECT().New("claim").Return("claim_aaa", nil)

	svc := service.NewProjectService(stubPool(), repo, ids)
	challenge, err := svc.InitClaim(context.Background(), service.InitProjectClaimInput{
		ProjectID:     "proj_aaa",
		ProjectSecret: "sk_proj_old",
	})
	require.NoError(t, err)
	require.Equal(t, "claim_aaa", challenge.ChallengeID)
	require.NotEmpty(t, challenge.ClaimURL)

	repo.EXPECT().
		Get(gomock.Any(), gomock.Any(), "proj_aaa").
		Return(&domain.Project{
			ID:            "proj_aaa",
			ProjectSecret: "sk_proj_old",
			Lifecycle:     domain.ProjectLifecycleUnclaimed,
			CreatedAt:     now,
			UpdatedAt:     now,
		}, nil)
	ids.EXPECT().New("sk_proj").Return("sk_proj_new", nil)
	ids.EXPECT().New("team").Return("team_aaa", nil)
	repo.EXPECT().
		Update(gomock.Any(), gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, _ database.QueryExecutor, p *domain.Project) error {
			assert.Equal(t, "sk_proj_new", p.ProjectSecret)
			assert.Equal(t, domain.ProjectLifecycleClaimed, p.Lifecycle)
			assert.Equal(t, "team_aaa", p.TeamID)
			assert.Equal(t, domain.ProjectTierFree, p.Tier)
			require.NotNil(t, p.ClaimedAt)
			return nil
		})
	repo.EXPECT().
		Get(gomock.Any(), gomock.Any(), "proj_aaa").
		Return(&domain.Project{
			ID:            "proj_aaa",
			ProjectSecret: "sk_proj_new",
			Lifecycle:     domain.ProjectLifecycleClaimed,
			TeamID:        "team_aaa",
			Tier:          domain.ProjectTierFree,
			ClaimedAt:     &now,
			CreatedAt:     now,
			UpdatedAt:     now,
		}, nil)

	claimed, err := svc.CompleteClaim(context.Background(), service.CompleteProjectClaimInput{
		ProjectID:   "proj_aaa",
		ChallengeID: "claim_aaa",
	})
	require.NoError(t, err)
	require.Equal(t, domain.ProjectLifecycleClaimed, claimed.Lifecycle)

	status, err := svc.GetClaimStatus(context.Background(), service.GetProjectClaimStatusInput{
		ProjectID:     "proj_aaa",
		ChallengeID:   "claim_aaa",
		ProjectSecret: "sk_proj_old",
	})
	require.NoError(t, err)
	assert.Equal(t, service.ProjectClaimStatusCompleted, status.Status)
	assert.Equal(t, "sk_proj_new", status.RotatedProjectSecret)

	status, err = svc.GetClaimStatus(context.Background(), service.GetProjectClaimStatusInput{
		ProjectID:     "proj_aaa",
		ChallengeID:   "claim_aaa",
		ProjectSecret: "sk_proj_old",
	})
	require.Nil(t, status)
	require.ErrorIs(t, err, domain.ErrProjectSecretConsumed())
}

type sequenceIDGenerator struct {
	mu       sync.Mutex
	counters map[string]int
}

func (g *sequenceIDGenerator) New(prefix string) (string, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.counters == nil {
		g.counters = make(map[string]int)
	}
	g.counters[prefix]++
	return fmt.Sprintf("%s_%03d", prefix, g.counters[prefix]), nil
}

type fakeProjectRepository struct {
	mu          sync.Mutex
	projects    map[string]*domain.Project
	createDelay time.Duration
	createCount int
}

func newFakeProjectRepository() *fakeProjectRepository {
	return &fakeProjectRepository{
		projects: make(map[string]*domain.Project),
	}
}

func (r *fakeProjectRepository) Create(_ context.Context, _ database.QueryExecutor, project *domain.Project) error {
	if r.createDelay > 0 {
		time.Sleep(r.createDelay)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.createCount++
	stored := cloneProject(project)
	stored.CreatedAt = time.Now().UTC()
	stored.UpdatedAt = stored.CreatedAt
	r.projects[stored.ID] = stored
	return nil
}

func (r *fakeProjectRepository) Get(_ context.Context, _ database.QueryExecutor, id string) (*domain.Project, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	project, ok := r.projects[id]
	if !ok {
		return nil, database.NewNoRowFoundError(nil)
	}
	return cloneProject(project), nil
}

func (r *fakeProjectRepository) Update(_ context.Context, _ database.QueryExecutor, project *domain.Project) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	stored := cloneProject(project)
	stored.UpdatedAt = time.Now().UTC()
	r.projects[stored.ID] = stored
	return nil
}

func (r *fakeProjectRepository) createCountValue() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.createCount
}

func cloneProject(project *domain.Project) *domain.Project {
	clone := *project
	if project.PreviewOrigins != nil {
		clone.PreviewOrigins = append([]string(nil), project.PreviewOrigins...)
	}
	return &clone
}
