package service_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/zitadel/nextgen/internal/domain"
	domainmock "github.com/zitadel/nextgen/internal/domain/mock"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"go.uber.org/mock/gomock"
)

func TestBrandingServiceCreate(t *testing.T) {
	ctrl := gomock.NewController(t)
	repo := domainmock.NewMockBrandingRepository(ctrl)
	svc := service.NewBrandingService(nil, repo)

	var stored *domain.Branding
	repo.EXPECT().
		Create(gomock.Any(), gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, _ database.QueryExecutor, b *domain.Branding) error {
			stored = b
			return nil
		})

	created, err := svc.Create(t.Context(), service.CreateBrandingInput{
		ProjectID:      "proj_1",
		Layout:         domain.BrandingLayoutSplit,
		LiquidTemplate: "<div>{% mandatory_gates %}</div>",
		LogoURL:        "https://cdn.example.com/logo.svg",
	})
	require.NoError(t, err)
	require.NotNil(t, stored)
	assert.Equal(t, created, stored)
	assert.True(t, strings.HasPrefix(created.ID, "brnd_"), "id %q should carry the brnd prefix", created.ID)
	assert.Equal(t, domain.BrandingLayoutSplit, created.Layout)
}

func TestBrandingServiceCreateRejectsInvalidTemplate(t *testing.T) {
	ctrl := gomock.NewController(t)
	repo := domainmock.NewMockBrandingRepository(ctrl)
	svc := service.NewBrandingService(nil, repo)
	// No repo.EXPECT().Create: validation must fail before any write.

	_, err := svc.Create(t.Context(), service.CreateBrandingInput{
		ProjectID:      "proj_1",
		LiquidTemplate: `<img src=x onerror="alert(1)">`,
	})
	require.Error(t, err)
	var domErr domain.Error
	require.True(t, errors.As(err, &domErr))
	assert.Equal(t, domain.ErrBrandingInvalid(nil, nil).Code, domErr.Code)
}

func TestBrandingServiceGetLatest(t *testing.T) {
	ctrl := gomock.NewController(t)
	repo := domainmock.NewMockBrandingRepository(ctrl)
	svc := service.NewBrandingService(nil, repo)

	want := &domain.Branding{ProjectID: "proj_1", ID: "brnd_1", Layout: domain.BrandingLayoutCentered}
	repo.EXPECT().
		GetLatest(gomock.Any(), gomock.Any(), "proj_1").
		Return(want, nil)

	got, err := svc.GetLatest(t.Context(), "proj_1")
	require.NoError(t, err)
	assert.Equal(t, want, got)
}

func TestBrandingServiceGetLatestNoneStored(t *testing.T) {
	ctrl := gomock.NewController(t)
	repo := domainmock.NewMockBrandingRepository(ctrl)
	svc := service.NewBrandingService(nil, repo)

	repo.EXPECT().
		GetLatest(gomock.Any(), gomock.Any(), "proj_1").
		Return(nil, &database.NoRowFoundError{})

	got, err := svc.GetLatest(t.Context(), "proj_1")
	require.NoError(t, err, "no stored branding is not an error — callers fall back to defaults")
	assert.Nil(t, got)
}

func TestBrandingServiceGetNotFound(t *testing.T) {
	ctrl := gomock.NewController(t)
	repo := domainmock.NewMockBrandingRepository(ctrl)
	svc := service.NewBrandingService(nil, repo)

	repo.EXPECT().
		GetByID(gomock.Any(), gomock.Any(), "proj_1", "brnd_missing").
		Return(nil, &database.NoRowFoundError{})

	_, err := svc.Get(t.Context(), "proj_1", "brnd_missing")
	var domErr domain.Error
	require.True(t, errors.As(err, &domErr))
	assert.Equal(t, domain.ErrBrandingNotFound().Code, domErr.Code)
}
