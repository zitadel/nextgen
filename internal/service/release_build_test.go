package service_test

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	servicemocks "github.com/zitadel/nextgen/internal/service/mocks"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func newMockedReleaseServiceWithBranding(t *testing.T) (service.ReleaseService, *servicemocks.MockAllStatements) {
	t.Helper()
	ctrl := gomock.NewController(t)
	pool := servicemocks.NewMockPool(ctrl)
	statements := servicemocks.NewMockAllStatements(ctrl)
	statementer := servicemocks.NewMockStatementer[service.AllStatements](ctrl)
	pool.EXPECT().Statements().Return(statements).AnyTimes()
	pool.EXPECT().
		Transaction(gomock.Any(), gomock.Any()).
		DoAndReturn(func(ctx context.Context, fn func(context.Context, service.Statementer[service.AllStatements]) error) error {
			return fn(ctx, statementer)
		}).
		AnyTimes()
	statementer.EXPECT().Statements().Return(statements).AnyTimes()
	statements.EXPECT().InsertEvent(gomock.Any(), gomock.Any()).Return(nil).AnyTimes()
	branding := service.NewBrandingService(service.NewPool(pool))
	return service.NewReleaseService(service.NewPool(pool), nil, nil, branding, nil, testBuiltinBases), statements
}

func TestBuildRelease_EmptyBundle(t *testing.T) {
	t.Parallel()
	svc, _ := newMockedReleaseService(t)
	_, err := svc.Build(t.Context(), service.BuildReleaseInput{ProjectID: "proj_1"})
	require.Error(t, err)
	var de domain.Error
	require.ErrorAs(t, err, &de)
	assert.Equal(t, domain.ErrReleaseInvalid(nil, nil).Code, de.Code)
	assert.Contains(t, de.Details, "empty")
}

func TestBuildRelease_DuplicateSchemaHandle(t *testing.T) {
	t.Parallel()
	svc, _ := newMockedReleaseService(t)
	doc := []byte(`{"kind":"user-schema","objectType":"human-user","metaSchema":"https://example.com/user-schema.json"}`)
	_, err := svc.Build(t.Context(), service.BuildReleaseInput{
		ProjectID: "proj_1",
		Schemas: []service.BuildSchema{
			{Index: 0, Document: doc},
			{Index: 1, Document: doc},
		},
	})
	require.Error(t, err)
	var bundleErr *service.BundleValidationError
	require.ErrorAs(t, err, &bundleErr)
	require.Len(t, bundleErr.Resources, 2)
	assert.Equal(t, domain.ReleasePointerKindSchema, bundleErr.Resources[0].Kind)
	assert.Contains(t, bundleErr.Resources[0].Err.Details.(string), "appears twice")
	assert.Contains(t, bundleErr.Resources[1].Err.Details.(string), "appears twice")
}

func TestBuildRelease_SchemaIDRefused(t *testing.T) {
	t.Parallel()
	svc, _ := newMockedReleaseService(t)
	doc := []byte(`{"$id":"https://example.com/human-user.json","kind":"user-schema","objectType":"human-user"}`)
	_, err := svc.Build(t.Context(), service.BuildReleaseInput{
		ProjectID: "proj_1",
		Schemas:   []service.BuildSchema{{Index: 0, Document: doc}},
	})
	require.Error(t, err)
	var bundleErr *service.BundleValidationError
	require.ErrorAs(t, err, &bundleErr)
	require.Len(t, bundleErr.Resources, 1)
	assert.Equal(t, domain.ReleasePointerKindSchema, bundleErr.Resources[0].Kind)
	assert.Contains(t, bundleErr.Resources[0].Err.Details.(string), "$id")
}

func TestBuildRelease_DuplicateFlowName(t *testing.T) {
	t.Parallel()
	svc, _ := newMockedReleaseService(t)
	_, err := svc.Build(t.Context(), service.BuildReleaseInput{
		ProjectID: "proj_1",
		FlowDefinitions: []service.BuildFlowDefinition{
			{Index: 0, Request: service.FlowDefinitionRequest{Name: "login"}},
			{Index: 1, Request: service.FlowDefinitionRequest{Name: "login"}},
		},
	})
	require.Error(t, err)
	var bundleErr *service.BundleValidationError
	require.ErrorAs(t, err, &bundleErr)
	require.Len(t, bundleErr.Resources, 2)
	assert.Equal(t, domain.ReleasePointerKindFlowDefinition, bundleErr.Resources[0].Kind)
	assert.Contains(t, bundleErr.Resources[0].Err.Details.(string), "appears twice")
}

func TestBuildRelease_InvalidBrandingAggregates(t *testing.T) {
	t.Parallel()
	svc, _ := newMockedReleaseService(t)
	_, err := svc.Build(t.Context(), service.BuildReleaseInput{
		ProjectID: "proj_1",
		Branding: &service.CreateBrandingInput{
			ProjectID:      "proj_1",
			Layout:         "not-a-layout",
			LiquidTemplate: `<script>alert(1)</script>`,
		},
	})
	require.Error(t, err)
	var bundleErr *service.BundleValidationError
	require.ErrorAs(t, err, &bundleErr)
	require.Len(t, bundleErr.Resources, 1)
	assert.Equal(t, domain.ReleasePointerKindBranding, bundleErr.Resources[0].Kind)
	assert.Equal(t, domain.ReleaseBrandingHandle, bundleErr.Resources[0].Handle)
	assert.Equal(t, domain.ErrBrandingInvalid(nil, nil).Code, bundleErr.Resources[0].Err.Code)
}

func TestBuildRelease_AllocatesBrandingAndCreatesRelease(t *testing.T) {
	t.Parallel()
	svc, statements := newMockedReleaseServiceWithBranding(t)

	statements.EXPECT().
		ListBrandings(gomock.Any(), gomock.Any()).
		Return(&database.ListResult[*domain.Branding]{}, nil)
	statements.EXPECT().
		CreateBranding(gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, entity *domain.Branding) error {
			entity.ID = "brnd_new"
			return nil
		})
	statements.EXPECT().
		GetReleaseByContentHash(gomock.Any(), "proj_1", gomock.Any()).
		Return(nil, new(database.NoRowFoundError))
	statements.EXPECT().
		CreateRelease(gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, rel *domain.Release) error {
			rel.ID = "rel_new"
			return nil
		})

	result, err := svc.Build(t.Context(), service.BuildReleaseInput{
		ProjectID: "proj_1",
		Branding: &service.CreateBrandingInput{
			ProjectID: "proj_1",
			Layout:    domain.BrandingLayoutCentered,
		},
		Message: new("first branding"),
	})
	require.NoError(t, err)
	assert.True(t, result.Created)
	require.Len(t, result.Release.Pointers, 1)
	assert.Equal(t, domain.ReleasePointerKindBranding, result.Release.Pointers[0].Kind)
	assert.Equal(t, "brnd_new", result.Release.Pointers[0].RevisionID)
}

func TestBuildRelease_ReusesUnchangedBranding(t *testing.T) {
	t.Parallel()
	svc, statements := newMockedReleaseServiceWithBranding(t)

	existing := &domain.Branding{
		ProjectID: "proj_1",
		ID:        "brnd_existing",
		Layout:    domain.BrandingLayoutCentered,
	}
	statements.EXPECT().
		ListBrandings(gomock.Any(), gomock.Any()).
		Return(&database.ListResult[*domain.Branding]{Items: []*domain.Branding{existing}}, nil)
	existingRelease := &domain.Release{
		ProjectID: "proj_1",
		ID:        "rel_existing",
		Pointers: []domain.ReleasePointer{{
			Kind:       domain.ReleasePointerKindBranding,
			Handle:     domain.ReleaseBrandingHandle,
			RevisionID: "brnd_existing",
		}},
		Metadata: domain.ReleaseMetadata{Message: new("kept")},
	}
	statements.EXPECT().
		GetReleaseByContentHash(gomock.Any(), "proj_1", gomock.Any()).
		Return(existingRelease, nil)

	result, err := svc.Build(t.Context(), service.BuildReleaseInput{
		ProjectID: "proj_1",
		Branding: &service.CreateBrandingInput{
			ProjectID: "proj_1",
			Layout:    domain.BrandingLayoutCentered,
		},
		Message: new("different message ignored on reuse"),
	})
	require.NoError(t, err)
	assert.False(t, result.Created)
	assert.Equal(t, "rel_existing", result.Release.ID)
}

func TestBuildRelease_CreateReleaseFailurePropagates(t *testing.T) {
	t.Parallel()
	svc, statements := newMockedReleaseServiceWithBranding(t)

	statements.EXPECT().
		ListBrandings(gomock.Any(), gomock.Any()).
		Return(&database.ListResult[*domain.Branding]{}, nil)
	statements.EXPECT().
		CreateBranding(gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, entity *domain.Branding) error {
			entity.ID = "brnd_orphan_candidate"
			return nil
		})
	statements.EXPECT().
		GetReleaseByContentHash(gomock.Any(), "proj_1", gomock.Any()).
		Return(nil, new(database.NoRowFoundError))
	statements.EXPECT().
		CreateRelease(gomock.Any(), gomock.Any()).
		Return(errors.New("forced release insert failure"))

	_, err := svc.Build(t.Context(), service.BuildReleaseInput{
		ProjectID: "proj_1",
		Branding: &service.CreateBrandingInput{
			ProjectID: "proj_1",
			Layout:    domain.BrandingLayoutCentered,
		},
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to build release")
}
