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
)

func TestFlowSSOProviderResolver_Resolve_DropsUnknownSlugsKeepsOrder(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	connections := servicemocks.NewMockIDPConnectionService(ctrl)
	// Storage order is unspecified, so the mock answers out of step order.
	connections.EXPECT().GetBySlugs(gomock.Any(), "proj-1", []string{"google", "gone", "github"}).
		Return([]*domain.IDPConnection{
			{ID: "idp-2", Slug: "github", Document: []byte(`{"display_name":"GitHub"}`)},
			{ID: "idp-1", Slug: "google", Document: []byte(`{"display_name":"Google","template":"google"}`)},
		}, nil)

	got, err := service.NewFlowSSOProviderResolver(connections).
		Resolve(t.Context(), "proj-1", "identifier", []string{"google", "gone", "github"})
	require.NoError(t, err)
	assert.Equal(t, []domain.FlowSSOProvider{
		{ID: "google", Name: "Google", Template: "google", ConnectionID: "idp-1"},
		{ID: "github", Name: "GitHub", ConnectionID: "idp-2"},
	}, got)
}

func TestFlowSSOProviderResolver_Resolve_PinnedRevision(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	connections := servicemocks.NewMockIDPConnectionService(ctrl)
	connections.EXPECT().GetRevision(gomock.Any(), "proj-1", "idprev_v1").
		Return(&domain.IDPConnection{
			ID: "idp-1", Slug: "google", RevisionID: "idprev_v1",
			Document: []byte(`{"display_name":"Google v1","template":"google"}`),
		}, nil)

	got, err := service.NewFlowSSOProviderResolver(connections).
		Resolve(pinnedFlowContext(t, domain.ReleasePointer{
			Kind: domain.ReleasePointerKindIDP, Handle: "google", RevisionID: "idprev_v1",
		}), "proj-1", "identifier", []string{"google"})
	require.NoError(t, err)
	assert.Equal(t, []domain.FlowSSOProvider{
		{ID: "google", Name: "Google v1", Template: "google", ConnectionID: "idp-1"},
	}, got)
}

func TestFlowSSOProviderResolver_Resolve_UnpinnedSlugIsInternal(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	connections := servicemocks.NewMockIDPConnectionService(ctrl)

	_, err := service.NewFlowSSOProviderResolver(connections).
		Resolve(pinnedFlowContext(t), "proj-1", "identifier", []string{"google"})
	require.ErrorIs(t, err, domain.ErrInternal(nil))
}

func TestFlowSSOProviderResolver_Resolve_ReleaseWithoutFlowKeepsNewest(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	connections := servicemocks.NewMockIDPConnectionService(ctrl)
	connections.EXPECT().GetBySlugs(gomock.Any(), "proj-1", []string{"google"}).
		Return([]*domain.IDPConnection{
			{ID: "idp-2", Slug: "google", Document: []byte(`{"display_name":"Google newest"}`)},
		}, nil)

	ctx := service.WithRuntimeResolution(t.Context(), &service.RuntimeResolution{
		Release: &domain.Release{Pointers: []domain.ReleasePointer{{
			Kind: domain.ReleasePointerKindIDP, Handle: "google", RevisionID: "idprev_v1",
		}}},
	})
	got, err := service.NewFlowSSOProviderResolver(connections).
		Resolve(ctx, "proj-1", "identifier", []string{"google"})
	require.NoError(t, err)
	assert.Equal(t, "Google newest", got[0].Name)
}

func pinnedFlowContext(t *testing.T, extra ...domain.ReleasePointer) context.Context {
	t.Helper()
	pointers := []domain.ReleasePointer{{
		Kind: domain.ReleasePointerKindFlowDefinition, Handle: "login", RevisionID: "flow_1",
	}}
	pointers = append(pointers, extra...)
	return service.WithRuntimeResolution(t.Context(), &service.RuntimeResolution{
		Release: &domain.Release{Pointers: pointers},
	})
}

func TestFlowSSOProviderResolver_Resolve_LookupErrorStopsResolution(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	connections := servicemocks.NewMockIDPConnectionService(ctrl)
	cause := errors.New("connection store unavailable")
	connections.EXPECT().GetBySlugs(gomock.Any(), "proj-1", []string{"google", "github"}).Return(nil, cause)

	_, err := service.NewFlowSSOProviderResolver(connections).
		Resolve(t.Context(), "proj-1", "identifier", []string{"google", "github"})
	require.ErrorIs(t, err, domain.ErrInternal(cause))
}
