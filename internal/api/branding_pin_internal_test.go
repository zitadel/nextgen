package api

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

type fakeBrandingReader struct {
	byID      map[string]*domain.Branding
	latest    *domain.Branding
	gotGetID  string
	gotLatest bool
	getErr    error
}

func (f *fakeBrandingReader) Get(_ context.Context, _, id string) (*domain.Branding, error) {
	f.gotGetID = id
	if f.getErr != nil {
		return nil, f.getErr
	}
	return f.byID[id], nil
}

func (f *fakeBrandingReader) GetLatest(context.Context, string) (*domain.Branding, error) {
	f.gotLatest = true
	return f.latest, nil
}

func TestResolveFlowBranding(t *testing.T) {
	v1 := &domain.Branding{ID: "brnd_v1", Layout: domain.BrandingLayoutSplit}
	v2 := &domain.Branding{ID: "brnd_v2", Layout: domain.BrandingLayoutCentered}
	flow := domain.ReleasePointer{Kind: domain.ReleasePointerKindFlowDefinition, Handle: "login", RevisionID: "flow_1"}
	brandingV1 := domain.ReleasePointer{Kind: domain.ReleasePointerKindBranding, Handle: domain.ReleaseBrandingHandle, RevisionID: v1.ID}

	t.Run("a release that pins a flow serves the pinned revision", func(t *testing.T) {
		reader := &fakeBrandingReader{byID: map[string]*domain.Branding{v1.ID: v1}, latest: v2}
		got := resolveFlowBranding(brandingContext(t, flow, brandingV1), reader, "proj")
		assert.Equal(t, api.BrandingLayoutSplit, got.Layout.Value)
		assert.Equal(t, v1.ID, reader.gotGetID)
		assert.False(t, reader.gotLatest)
	})

	t.Run("a release that pins a flow and no branding serves the built-in default", func(t *testing.T) {
		reader := &fakeBrandingReader{latest: v2}
		got := resolveFlowBranding(brandingContext(t, flow), reader, "proj")
		assert.Equal(t, api.BrandingLayoutCentered, got.Layout.Value)
		assert.Empty(t, reader.gotGetID)
		assert.False(t, reader.gotLatest)
	})

	t.Run("a failed read of a pinned revision serves the built-in default", func(t *testing.T) {
		reader := &fakeBrandingReader{getErr: errors.New("db down")}
		got := resolveFlowBranding(brandingContext(t, flow, brandingV1), reader, "proj")
		assert.Equal(t, api.BrandingLayoutCentered, got.Layout.Value)
		assert.Equal(t, v1.ID, reader.gotGetID)
	})

	t.Run("no release serves the newest revision", func(t *testing.T) {
		reader := &fakeBrandingReader{byID: map[string]*domain.Branding{v1.ID: v1}, latest: v2}
		got := resolveFlowBranding(t.Context(), reader, "proj")
		assert.Equal(t, api.BrandingLayoutCentered, got.Layout.Value)
		assert.True(t, reader.gotLatest)
		assert.Empty(t, reader.gotGetID)
	})

	t.Run("a release that pins no flow serves the newest revision", func(t *testing.T) {
		reader := &fakeBrandingReader{latest: v2}
		got := resolveFlowBranding(brandingContext(t, brandingV1), reader, "proj")
		assert.True(t, reader.gotLatest)
		require.Equal(t, api.BrandingLayoutCentered, got.Layout.Value)
	})
}

func brandingContext(t *testing.T, pointers ...domain.ReleasePointer) context.Context {
	t.Helper()
	return service.WithRuntimeResolution(t.Context(), &service.RuntimeResolution{
		Release: &domain.Release{Pointers: pointers},
	})
}
