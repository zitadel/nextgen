package service_test

import (
	"errors"
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

// ownOrigin is the deployment's own origin the mocked resolver is built with.
const ownOrigin = "https://zitadel.example.com"

func newMockedRuntimeResolver(t *testing.T) (*service.RuntimeResolver, *servicemocks.MockAllStatements, *servicemocks.MockReleaseService) {
	t.Helper()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	statements := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(statements).AnyTimes()
	releases := servicemocks.NewMockReleaseService(ctrl)
	return service.NewRuntimeResolver(service.NewPool(pool), releases, ownOrigin), statements, releases
}

func TestRuntimeResolver_Resolve(t *testing.T) {
	const projectID = "proj_1"
	const origin = "https://app.acme.com"

	t.Run("absent origin is not deployed", func(t *testing.T) {
		resolver, statements, _ := newMockedRuntimeResolver(t)
		statements.EXPECT().GetProjectByID(gomock.Any(), projectID).Return(&domain.Project{ID: projectID}, nil)
		_, err := resolver.Resolve(t.Context(), projectID, "")
		require.Error(t, err)
		assert.True(t, errors.Is(err, domain.ErrReleaseNotDeployed(nil)))
	})

	t.Run("origin not allowed", func(t *testing.T) {
		resolver, statements, _ := newMockedRuntimeResolver(t)
		statements.EXPECT().GetProjectByID(gomock.Any(), projectID).Return(&domain.Project{
			ID: projectID,
			Origins: []domain.Origin{
				{Pattern: origin, Kind: domain.OriginKindPrimary},
			},
		}, nil)
		_, err := resolver.Resolve(t.Context(), projectID, "https://evil.example")
		require.Error(t, err)
		assert.True(t, errors.Is(err, domain.ErrProjectOriginNotAllowed(nil)))
	})

	t.Run("preview not live", func(t *testing.T) {
		resolver, statements, _ := newMockedRuntimeResolver(t)
		previewURL := "https://branch-acme.vercel.app"
		statements.EXPECT().GetProjectByID(gomock.Any(), projectID).Return(&domain.Project{
			ID: projectID,
			Origins: []domain.Origin{
				{Pattern: "https://*-acme.vercel.app", Kind: domain.OriginKindPreview},
			},
		}, nil)
		statements.EXPECT().GetPreview(gomock.Any(), projectID, previewURL).
			Return(nil, &database.NoRowFoundError{})
		_, err := resolver.Resolve(t.Context(), projectID, previewURL)
		require.Error(t, err)
		assert.True(t, errors.Is(err, domain.ErrProjectPreviewNotLive(nil)))
	})

	t.Run("empty allowlist with no deployment keeps pre-resolution path", func(t *testing.T) {
		resolver, statements, _ := newMockedRuntimeResolver(t)
		statements.EXPECT().GetProjectByID(gomock.Any(), projectID).Return(&domain.Project{
			ID: projectID,
		}, nil)
		statements.EXPECT().GetNewestPerOrigin(gomock.Any(), projectID, []string{origin}).
			Return([]domain.OriginDeployment{}, nil)

		got, err := resolver.Resolve(t.Context(), projectID, origin)
		require.NoError(t, err)
		assert.Nil(t, got)
	})

	t.Run("loopback with no deployment keeps pre-resolution path", func(t *testing.T) {
		resolver, statements, _ := newMockedRuntimeResolver(t)
		loopback := "http://localhost:3000"
		statements.EXPECT().GetProjectByID(gomock.Any(), projectID).Return(&domain.Project{
			ID: projectID,
			Origins: []domain.Origin{
				{Pattern: origin, Kind: domain.OriginKindPrimary},
			},
		}, nil)
		statements.EXPECT().GetNewestPerOrigin(gomock.Any(), projectID, []string{loopback}).
			Return([]domain.OriginDeployment{}, nil)

		got, err := resolver.Resolve(t.Context(), projectID, loopback)
		require.NoError(t, err)
		assert.Nil(t, got)
	})

	t.Run("own origin with no deployment keeps pre-resolution path", func(t *testing.T) {
		resolver, statements, _ := newMockedRuntimeResolver(t)
		statements.EXPECT().GetProjectByID(gomock.Any(), projectID).Return(&domain.Project{
			ID: projectID,
			Origins: []domain.Origin{
				{Pattern: origin, Kind: domain.OriginKindPrimary},
			},
		}, nil)
		statements.EXPECT().GetNewestPerOrigin(gomock.Any(), projectID, []string{ownOrigin}).
			Return([]domain.OriginDeployment{}, nil)

		got, err := resolver.Resolve(t.Context(), projectID, ownOrigin)
		require.NoError(t, err)
		assert.Nil(t, got)
	})

	t.Run("primary origin with no deployment is not deployed", func(t *testing.T) {
		resolver, statements, _ := newMockedRuntimeResolver(t)
		statements.EXPECT().GetProjectByID(gomock.Any(), projectID).Return(&domain.Project{
			ID: projectID,
			Origins: []domain.Origin{
				{Pattern: origin, Kind: domain.OriginKindPrimary},
			},
		}, nil)
		statements.EXPECT().GetNewestPerOrigin(gomock.Any(), projectID, []string{origin}).
			Return([]domain.OriginDeployment{}, nil)

		_, err := resolver.Resolve(t.Context(), projectID, origin)
		require.Error(t, err)
		assert.True(t, errors.Is(err, domain.ErrReleaseNotDeployed(nil)))
	})

	t.Run("primary origin with deployment seals release", func(t *testing.T) {
		resolver, statements, releases := newMockedRuntimeResolver(t)
		statements.EXPECT().GetProjectByID(gomock.Any(), projectID).Return(&domain.Project{
			ID: projectID,
			Origins: []domain.Origin{
				{Pattern: origin, Kind: domain.OriginKindPrimary},
			},
		}, nil)
		statements.EXPECT().GetNewestPerOrigin(gomock.Any(), projectID, []string{origin}).Return([]domain.OriginDeployment{{
			Origin: origin, DeploymentID: "dep_1", ReleaseID: "rel_1", DeployedAt: time.Now(),
		}}, nil)
		statements.EXPECT().GetDeploymentByID(gomock.Any(), projectID, "dep_1").Return(&domain.Deployment{
			ID: "dep_1", ProjectID: projectID, ReleaseID: "rel_1",
		}, nil)
		releases.EXPECT().Get(gomock.Any(), projectID, "rel_1").Return(&domain.Release{
			ID: "rel_1", ProjectID: projectID, ContentHash: "sha256:abc",
		}, nil)

		got, err := resolver.Resolve(t.Context(), projectID, origin)
		require.NoError(t, err)
		require.NotNil(t, got.Deployment)
		require.NotNil(t, got.Release)
		assert.Equal(t, "dep_1", got.Deployment.ID)
		assert.Equal(t, "rel_1", got.Release.ID)
		assert.Equal(t, "origin", got.Source)
		assert.Equal(t, origin, got.Origin)
		assert.Equal(t, origin, got.Target)
	})

	t.Run("preview wildcard keeps request Origin and matched pattern Target", func(t *testing.T) {
		resolver, statements, releases := newMockedRuntimeResolver(t)
		previewURL := "https://branch-acme.vercel.app"
		pattern := "https://*-acme.vercel.app"
		statements.EXPECT().GetProjectByID(gomock.Any(), projectID).Return(&domain.Project{
			ID: projectID,
			Origins: []domain.Origin{
				{Pattern: pattern, Kind: domain.OriginKindPreview},
			},
		}, nil)
		statements.EXPECT().GetPreview(gomock.Any(), projectID, previewURL).Return(&domain.Preview{
			ProjectID: projectID, Origin: previewURL, ExpiresAt: time.Now().Add(time.Hour),
		}, nil)
		statements.EXPECT().GetNewestPerOrigin(gomock.Any(), projectID, []string{previewURL}).Return([]domain.OriginDeployment{{
			Origin: previewURL, DeploymentID: "dep_1", ReleaseID: "rel_1", DeployedAt: time.Now(),
		}}, nil)
		statements.EXPECT().GetDeploymentByID(gomock.Any(), projectID, "dep_1").Return(&domain.Deployment{
			ID: "dep_1", ProjectID: projectID, ReleaseID: "rel_1",
		}, nil)
		releases.EXPECT().Get(gomock.Any(), projectID, "rel_1").Return(&domain.Release{
			ID: "rel_1", ProjectID: projectID, ContentHash: "sha256:abc",
		}, nil)

		got, err := resolver.Resolve(t.Context(), projectID, previewURL)
		require.NoError(t, err)
		require.NotNil(t, got)
		assert.Equal(t, previewURL, got.Origin)
		assert.Equal(t, pattern, got.Target)
		assert.Equal(t, "origin", got.Source)
		assert.Equal(t, "dep_1", got.Deployment.ID)
	})

	t.Run("revoked release refused", func(t *testing.T) {
		resolver, statements, releases := newMockedRuntimeResolver(t)
		revokedAt := time.Now()
		statements.EXPECT().GetProjectByID(gomock.Any(), projectID).Return(&domain.Project{
			ID: projectID,
			Origins: []domain.Origin{
				{Pattern: origin, Kind: domain.OriginKindPrimary},
			},
		}, nil)
		statements.EXPECT().GetNewestPerOrigin(gomock.Any(), projectID, []string{origin}).Return([]domain.OriginDeployment{{
			Origin: origin, DeploymentID: "dep_1", ReleaseID: "rel_1", DeployedAt: time.Now(),
		}}, nil)
		statements.EXPECT().GetDeploymentByID(gomock.Any(), projectID, "dep_1").Return(&domain.Deployment{
			ID: "dep_1", ProjectID: projectID, ReleaseID: "rel_1",
		}, nil)
		releases.EXPECT().Get(gomock.Any(), projectID, "rel_1").Return(&domain.Release{
			ID: "rel_1", ProjectID: projectID, RevokedAt: &revokedAt,
		}, nil)

		_, err := resolver.Resolve(t.Context(), projectID, origin)
		require.Error(t, err)
		assert.True(t, errors.Is(err, domain.ErrReleaseRevoked()))
	})
}

// Gate is what the steps of an attempt answer to, not only its opening. The
// deployment's own origin opens a flow (Resolve above) but passes no Gate of
// a project that lists its origins.
func TestRuntimeResolver_Gate(t *testing.T) {
	resolver, _, _ := newMockedRuntimeResolver(t)
	project := &domain.Project{
		ID: "proj_1",
		Origins: []domain.Origin{
			{Pattern: "https://app.acme.com", Kind: domain.OriginKindPrimary},
		},
	}

	_, err := resolver.Gate(t.Context(), project, ownOrigin)
	require.Error(t, err)
	assert.True(t, errors.Is(err, domain.ErrProjectOriginNotAllowed(nil)))
}
