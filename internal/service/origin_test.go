package service_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
)

func TestProjectService_AddOrigin(t *testing.T) {
	t.Parallel()

	project := &domain.Project{ID: "proj_aaa", Name: "aaa"}
	origin := domain.Origin{Pattern: "https://preview.example.com", Kind: domain.OriginKindPreview}

	t.Run("inserts and emits", func(t *testing.T) {
		t.Parallel()
		svc, _, _, _, _, _, _, _, _, statements := createMockedProjectService(t)
		statements.EXPECT().ProjectExists(gomock.Any(), project.ID).Return(true, nil)
		statements.EXPECT().InsertOrigin(gomock.Any(), project.ID, origin).Return(true, nil)

		got, err := svc.AddOrigin(context.Background(), project.ID, origin)
		require.NoError(t, err)
		assert.Equal(t, &origin, got)
	})

	t.Run("idempotent same kind", func(t *testing.T) {
		t.Parallel()
		svc, _, _, _, _, _, _, _, _, statements := createMockedProjectService(t)
		statements.EXPECT().ProjectExists(gomock.Any(), project.ID).Return(true, nil)
		statements.EXPECT().InsertOrigin(gomock.Any(), project.ID, origin).Return(false, nil)
		statements.EXPECT().GetOrigin(gomock.Any(), gomock.Any()).
			Return(&origin, nil)

		got, err := svc.AddOrigin(context.Background(), project.ID, origin)
		require.NoError(t, err)
		assert.Equal(t, &origin, got)
	})

	t.Run("kind conflict", func(t *testing.T) {
		t.Parallel()
		svc, _, _, _, _, _, _, _, _, statements := createMockedProjectService(t)
		existing := domain.Origin{Pattern: origin.Pattern, Kind: domain.OriginKindPrimary}
		statements.EXPECT().ProjectExists(gomock.Any(), project.ID).Return(true, nil)
		statements.EXPECT().InsertOrigin(gomock.Any(), project.ID, origin).Return(false, nil)
		statements.EXPECT().GetOrigin(gomock.Any(), gomock.Any()).
			Return(&existing, nil)

		got, err := svc.AddOrigin(context.Background(), project.ID, origin)
		require.ErrorIs(t, err, domain.ErrOriginKindConflict())
		assert.Nil(t, got)
	})

	t.Run("rejects unbounded shared host", func(t *testing.T) {
		t.Parallel()
		svc, _, _, _, _, _, _, _, _, _ := createMockedProjectService(t)
		got, err := svc.AddOrigin(context.Background(), project.ID, domain.Origin{
			Pattern: "https://*.vercel.app",
			Kind:    domain.OriginKindPreview,
		})
		require.ErrorIs(t, err, domain.ErrOriginUnbounded())
		assert.Nil(t, got)
	})

	t.Run("rejects primary wildcard", func(t *testing.T) {
		t.Parallel()
		svc, _, _, _, _, _, _, _, _, _ := createMockedProjectService(t)
		got, err := svc.AddOrigin(context.Background(), project.ID, domain.Origin{
			Pattern: "https://*.example.com",
			Kind:    domain.OriginKindPrimary,
		})
		require.ErrorIs(t, err, domain.ErrOriginPrimaryNotExact())
		assert.Nil(t, got)
	})

	t.Run("project missing", func(t *testing.T) {
		t.Parallel()
		svc, _, _, _, _, _, _, _, _, statements := createMockedProjectService(t)
		statements.EXPECT().ProjectExists(gomock.Any(), project.ID).Return(false, nil)

		got, err := svc.AddOrigin(context.Background(), project.ID, origin)
		require.ErrorIs(t, err, domain.ErrProjectNotFound())
		assert.Nil(t, got)
	})
}

func TestProjectService_RemoveOrigin(t *testing.T) {
	t.Parallel()

	project := &domain.Project{ID: "proj_aaa", Name: "aaa"}
	origin := domain.Origin{Pattern: "https://tmp.example.com", Kind: domain.OriginKindPrimary}

	t.Run("deletes and emits", func(t *testing.T) {
		t.Parallel()
		svc, _, _, _, _, _, _, _, _, statements := createMockedProjectService(t)
		statements.EXPECT().ProjectExists(gomock.Any(), project.ID).Return(true, nil)
		statements.EXPECT().DeleteOriginByPattern(gomock.Any(), project.ID, origin.Pattern).
			Return(true, &origin, nil)

		require.NoError(t, svc.RemoveOrigin(context.Background(), project.ID, origin.Pattern))
	})

	t.Run("idempotent when missing", func(t *testing.T) {
		t.Parallel()
		svc, _, _, _, _, _, _, _, _, statements := createMockedProjectService(t)
		statements.EXPECT().ProjectExists(gomock.Any(), project.ID).Return(true, nil)
		statements.EXPECT().DeleteOriginByPattern(gomock.Any(), project.ID, origin.Pattern).
			Return(false, nil, nil)

		require.NoError(t, svc.RemoveOrigin(context.Background(), project.ID, origin.Pattern))
	})

	t.Run("empty pattern", func(t *testing.T) {
		t.Parallel()
		svc, _, _, _, _, _, _, _, _, _ := createMockedProjectService(t)
		err := svc.RemoveOrigin(context.Background(), project.ID, "  ")
		require.ErrorIs(t, err, domain.ErrOriginInvalid())
	})
}

func TestProjectService_Create_RejectsInvalidOrigins(t *testing.T) {
	t.Parallel()
	svc, _, _, _, _, _, _, _, _, _ := createMockedProjectService(t)
	got, err := svc.Create(context.Background(), "test", []domain.Origin{
		{Pattern: "https://*.vercel.app", Kind: domain.OriginKindPreview},
	}, false)
	require.ErrorIs(t, err, domain.ErrOriginUnbounded())
	assert.Nil(t, got)
}
