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

func newMockedReleaseServiceWithOAuth(t *testing.T) (service.ReleaseService, *servicemocks.MockAllStatements) {
	t.Helper()
	pool, statements := mockedBuildPool(t)
	return service.NewReleaseService(pool, nil, nil, nil, nil, nil, service.NewOAuthSettingsService(pool), testBuiltinBases), statements
}

func TestBuildRelease_AllocatesOAuthSettingsAndCreatesRelease(t *testing.T) {
	t.Parallel()
	svc, statements := newMockedReleaseServiceWithOAuth(t)

	statements.EXPECT().
		ListOAuthSettings(gomock.Any(), gomock.Any()).
		Return(&database.ListResult[*domain.OAuthSettings]{}, nil)
	statements.EXPECT().
		CreateOAuthSettings(gomock.Any(), gomock.Any()).
		DoAndReturn(func(_ context.Context, entity *domain.OAuthSettings) error {
			assert.Equal(t, "proj_1", entity.ProjectID)
			assert.True(t, entity.Enabled)
			entity.ID = "oauthset_new"
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
		OAuth:     &service.CreateOAuthSettingsInput{ProjectID: "proj_1", Enabled: true},
	})
	require.NoError(t, err)
	assert.True(t, result.Created)
	require.Len(t, result.Release.Pointers, 1)
	assert.Equal(t, domain.ReleasePointerKindOauth, result.Release.Pointers[0].Kind)
	assert.Equal(t, domain.ReleaseOAuthHandle, result.Release.Pointers[0].Handle)
	assert.Equal(t, "oauthset_new", result.Release.Pointers[0].RevisionID)
}

// A revision that says the same thing is reused, whatever its age: the
// newest one is off, an older one is on, and the bundle asks for on.
func TestBuildRelease_ReusesMatchingOAuthSettings(t *testing.T) {
	t.Parallel()
	svc, statements := newMockedReleaseServiceWithOAuth(t)

	statements.EXPECT().
		ListOAuthSettings(gomock.Any(), gomock.Any()).
		Return(&database.ListResult[*domain.OAuthSettings]{Items: []*domain.OAuthSettings{
			{ProjectID: "proj_1", ID: "oauthset_off"},
			{ProjectID: "proj_1", ID: "oauthset_on", Enabled: true},
		}}, nil)
	existingRelease := &domain.Release{
		ProjectID: "proj_1",
		ID:        "rel_existing",
		Pointers: []domain.ReleasePointer{{
			Kind:       domain.ReleasePointerKindOauth,
			Handle:     domain.ReleaseOAuthHandle,
			RevisionID: "oauthset_on",
		}},
	}
	statements.EXPECT().
		GetReleaseByContentHash(gomock.Any(), "proj_1", domain.ReleaseContentHash(existingRelease.Pointers)).
		Return(existingRelease, nil)

	result, err := svc.Build(t.Context(), service.BuildReleaseInput{
		ProjectID: "proj_1",
		OAuth:     &service.CreateOAuthSettingsInput{ProjectID: "proj_1", Enabled: true},
	})
	require.NoError(t, err)
	assert.False(t, result.Created)
	assert.Equal(t, "rel_existing", result.Release.ID)
}

func TestBuildRelease_InvalidOAuthSettingsAggregates(t *testing.T) {
	t.Parallel()
	svc, _ := newMockedReleaseServiceWithOAuth(t)

	// The handler always sets the project; a caller that does not is refused
	// per resource, like an invalid branding.
	_, err := svc.Build(t.Context(), service.BuildReleaseInput{
		ProjectID: "proj_1",
		OAuth:     &service.CreateOAuthSettingsInput{Enabled: true},
	})
	require.Error(t, err)
	var bundleErr *service.BundleValidationError
	require.ErrorAs(t, err, &bundleErr)
	require.Len(t, bundleErr.Resources, 1)
	assert.Equal(t, domain.ReleasePointerKindOauth, bundleErr.Resources[0].Kind)
	assert.Equal(t, 0, bundleErr.Resources[0].Index)
	assert.Equal(t, domain.ReleaseOAuthHandle, bundleErr.Resources[0].Handle)
	assert.Equal(t, domain.ErrOAuthSettingsMissingProjectID().Code, bundleErr.Resources[0].Err.Code)
}

func TestOAuthSettingsService_Get(t *testing.T) {
	t.Parallel()
	pool, statements := mockedBuildPool(t)
	svc := service.NewOAuthSettingsService(pool)

	statements.EXPECT().
		GetOAuthSettingsByID(gomock.Any(), "proj_1", "oauthset_missing").
		Return(nil, new(database.NoRowFoundError))
	_, err := svc.Get(t.Context(), "proj_1", "oauthset_missing")
	assert.ErrorIs(t, err, domain.ErrOAuthSettingsNotFound())

	statements.EXPECT().
		GetOAuthSettingsByID(gomock.Any(), "proj_1", "oauthset_1").
		Return(&domain.OAuthSettings{ProjectID: "proj_1", ID: "oauthset_1", Enabled: true}, nil)
	got, err := svc.Get(t.Context(), "proj_1", "oauthset_1")
	require.NoError(t, err)
	assert.True(t, got.Enabled)

	statements.EXPECT().
		GetOAuthSettingsByID(gomock.Any(), "proj_1", "oauthset_down").
		Return(nil, errors.New("connection reset"))
	_, err = svc.Get(t.Context(), "proj_1", "oauthset_down")
	assert.True(t, domain.IsServerFault(err), "a database failure is a fault, not a refusal")
}

// fakeOAuthSettingsReader answers Get from a map of revision id to revision.
type fakeOAuthSettingsReader struct {
	revisions map[string]*domain.OAuthSettings
	calls     []string
}

func (f *fakeOAuthSettingsReader) Get(_ context.Context, projectID, id string) (*domain.OAuthSettings, error) {
	f.calls = append(f.calls, projectID+"/"+id)
	if s, ok := f.revisions[id]; ok {
		return s, nil
	}
	return nil, domain.ErrOAuthSettingsNotFound()
}

func TestResolveOAuthSettings(t *testing.T) {
	t.Parallel()

	t.Run("no pin means none", func(t *testing.T) {
		t.Parallel()
		reader := &fakeOAuthSettingsReader{}
		got, err := service.ResolveOAuthSettings(t.Context(), reader, "proj_1", domain.ReleasePins{})
		require.NoError(t, err)
		assert.Nil(t, got)
		assert.Empty(t, reader.calls, "nothing to read without a pin")
	})

	t.Run("the pin names the revision", func(t *testing.T) {
		t.Parallel()
		reader := &fakeOAuthSettingsReader{revisions: map[string]*domain.OAuthSettings{
			"oauthset_1": {ProjectID: "proj_1", ID: "oauthset_1", Enabled: true},
		}}
		pins := domain.ReleasePins{domain.ReleaseOAuthHandle: {Kind: domain.ReleasePointerKindOauth, Handle: domain.ReleaseOAuthHandle, RevisionID: "oauthset_1"}}
		got, err := service.ResolveOAuthSettings(t.Context(), reader, "proj_1", pins)
		require.NoError(t, err)
		assert.True(t, got.Enabled)
		assert.Equal(t, []string{"proj_1/oauthset_1"}, reader.calls)
	})

	t.Run("a missing pinned revision is the server's fault", func(t *testing.T) {
		t.Parallel()
		reader := &fakeOAuthSettingsReader{}
		pins := domain.ReleasePins{domain.ReleaseOAuthHandle: {Kind: domain.ReleasePointerKindOauth, Handle: domain.ReleaseOAuthHandle, RevisionID: "oauthset_gone"}}
		_, err := service.ResolveOAuthSettings(t.Context(), reader, "proj_1", pins)
		require.Error(t, err)
		assert.True(t, domain.IsServerFault(err), "the cause stays in the chain, but the answer is a fault")
	})
}
