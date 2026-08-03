package service_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func newMockedBrandingService(t *testing.T) (*service.BrandingService, *servicemocks.MockAllStatements) {
	t.Helper()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	statements := servicemocks.NewMockAllStatements(ctrl)
	pool.EXPECT().Statements().Return(statements).AnyTimes()
	return service.NewBrandingService(service.NewPool(pool)), statements
}

func TestBrandingServiceCreate(t *testing.T) {
	svc, statements := newMockedBrandingService(t)

	var stored *domain.Branding
	statements.EXPECT().
		CreateBranding(gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, b *domain.Branding) error {
			b.ID = "brnd_test01"
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
	svc, _ := newMockedBrandingService(t)

	_, err := svc.Create(t.Context(), service.CreateBrandingInput{
		ProjectID:      "proj_1",
		LiquidTemplate: `<img src=x onerror="alert(1)">`,
	})
	require.Error(t, err)
	var domErr domain.Error
	require.True(t, errors.As(err, &domErr))
	assert.Equal(t, domain.ErrBrandingInvalid(nil, nil).Code, domErr.Code)
}

func TestBrandingServiceCreateMapsIntegrityViolation(t *testing.T) {
	svc, statements := newMockedBrandingService(t)

	statements.EXPECT().
		CreateBranding(gomock.Any(), gomock.Any()).
		Return(database.NewForeignKeyError("branding", "fk_branding_project", nil))

	_, err := svc.Create(t.Context(), service.CreateBrandingInput{
		ProjectID: "proj_missing",
	})
	require.Error(t, err)
	var domErr domain.Error
	require.True(t, errors.As(err, &domErr))
	assert.Equal(t, domain.ErrBrandingInvalid(nil, nil).Code, domErr.Code)
}

func TestBrandingServiceGetLatest(t *testing.T) {
	svc, statements := newMockedBrandingService(t)

	want := &domain.Branding{ProjectID: "proj_1", ID: "brnd_1", Layout: domain.BrandingLayoutCentered}
	statements.EXPECT().
		ListBrandings(gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, opts *database.ListOptions[domain.BrandingField]) (*database.ListResult[*domain.Branding], error) {
			assert.Equal(t, uint32(1), opts.Pagination.Limit)
			return &database.ListResult[*domain.Branding]{Items: []*domain.Branding{want}}, nil
		})

	got, err := svc.GetLatest(t.Context(), "proj_1")
	require.NoError(t, err)
	assert.Equal(t, want, got)
}

func TestBrandingServiceGetLatestNoneStored(t *testing.T) {
	svc, statements := newMockedBrandingService(t)

	statements.EXPECT().
		ListBrandings(gomock.Any(), gomock.Any()).
		Return(&database.ListResult[*domain.Branding]{}, nil)

	got, err := svc.GetLatest(t.Context(), "proj_1")
	require.NoError(t, err, "no stored branding is not an error — callers fall back to defaults")
	assert.Nil(t, got)
}

func TestBrandingServiceGetNotFound(t *testing.T) {
	svc, statements := newMockedBrandingService(t)

	statements.EXPECT().
		GetBrandingByID(gomock.Any(), "proj_1", "brnd_missing").
		Return(nil, &database.NoRowFoundError{})

	_, err := svc.Get(t.Context(), "proj_1", "brnd_missing")
	var domErr domain.Error
	require.True(t, errors.As(err, &domErr))
	assert.Equal(t, domain.ErrBrandingNotFound().Code, domErr.Code)
}
