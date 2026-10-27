package service_test

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

type fakeBrandingReader struct {
	byID     map[string]*domain.Branding
	gotGetID string
	getErr   error
}

func (f *fakeBrandingReader) Get(_ context.Context, _, id string) (*domain.Branding, error) {
	f.gotGetID = id
	if f.getErr != nil {
		return nil, f.getErr
	}
	return f.byID[id], nil
}

func TestResolveFlowBranding(t *testing.T) {
	v1 := &domain.Branding{ID: "brnd_v1", Layout: domain.BrandingLayoutSplit}
	flow := domain.ReleasePointer{Kind: domain.ReleasePointerKindFlowDefinition, Handle: "login", RevisionID: "flow_1"}
	brandingV1 := domain.ReleasePointer{Kind: domain.ReleasePointerKindBranding, Handle: domain.ReleaseBrandingHandle, RevisionID: v1.ID}

	t.Run("a release that pins a flow serves the pinned revision", func(t *testing.T) {
		reader := &fakeBrandingReader{byID: map[string]*domain.Branding{v1.ID: v1}}
		got, err := service.ResolveFlowBranding(brandingContext(t, flow, brandingV1), reader, "proj")
		require.NoError(t, err)
		assert.Equal(t, v1, got)
		assert.Equal(t, v1.ID, reader.gotGetID)
	})

	t.Run("a release that pins a flow and no branding returns nil", func(t *testing.T) {
		reader := &fakeBrandingReader{}
		got, err := service.ResolveFlowBranding(brandingContext(t, flow), reader, "proj")
		require.NoError(t, err)
		assert.Nil(t, got)
		assert.Empty(t, reader.gotGetID)
	})

	t.Run("a failed read of a pinned revision is returned", func(t *testing.T) {
		reader := &fakeBrandingReader{getErr: errors.New("db down")}
		got, err := service.ResolveFlowBranding(brandingContext(t, flow, brandingV1), reader, "proj")
		require.EqualError(t, err, "db down")
		assert.Nil(t, got)
		assert.Equal(t, v1.ID, reader.gotGetID)
	})

	t.Run("no release is not deployed", func(t *testing.T) {
		reader := &fakeBrandingReader{byID: map[string]*domain.Branding{v1.ID: v1}}
		got, err := service.ResolveFlowBranding(t.Context(), reader, "proj")
		require.ErrorIs(t, err, domain.ErrReleaseNotDeployed(nil))
		assert.Nil(t, got)
		assert.Empty(t, reader.gotGetID)
	})

	t.Run("a release that pins no flow serves the branding it pins", func(t *testing.T) {
		reader := &fakeBrandingReader{byID: map[string]*domain.Branding{v1.ID: v1}}
		got, err := service.ResolveFlowBranding(brandingContext(t, brandingV1), reader, "proj")
		require.NoError(t, err)
		assert.Equal(t, v1, got)
		assert.Equal(t, v1.ID, reader.gotGetID)
	})
}

func brandingContext(t *testing.T, pointers ...domain.ReleasePointer) context.Context {
	t.Helper()
	return service.WithRuntimeResolution(t.Context(), &service.RuntimeResolution{
		Release: &domain.Release{Pointers: pointers},
	})
}
