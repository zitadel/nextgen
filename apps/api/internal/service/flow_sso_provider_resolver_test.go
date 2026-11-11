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

func TestFlowSSOProviderResolver_Resolve_NoReleaseIsNotDeployed(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	connections := servicemocks.NewMockIDPConnectionService(ctrl)

	_, err := service.NewFlowSSOProviderResolver(connections).
		Resolve(t.Context(), "proj-1", []string{"google", "gone", "github"})
	require.ErrorIs(t, err, domain.ErrReleaseNotDeployed(nil))
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
		}), "proj-1", []string{"google"})
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
		Resolve(pinnedFlowContext(t), "proj-1", []string{"google"})
	require.ErrorIs(t, err, domain.ErrInternal(nil))
}

func pinnedFlowContext(t *testing.T, pointers ...domain.ReleasePointer) context.Context {
	t.Helper()
	return service.WithRuntimeResolution(t.Context(), &service.RuntimeResolution{
		Release: &domain.Release{Pointers: pointers},
	})
}

func TestFlowSSOProviderResolver_Resolve_LookupErrorStopsResolution(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	connections := servicemocks.NewMockIDPConnectionService(ctrl)
	cause := errors.New("connection store unavailable")
	connections.EXPECT().GetRevision(gomock.Any(), "proj-1", "idprev_google").Return(nil, cause)

	_, err := service.NewFlowSSOProviderResolver(connections).
		Resolve(pinnedFlowContext(t,
			domain.ReleasePointer{Kind: domain.ReleasePointerKindIDP, Handle: "google", RevisionID: "idprev_google"},
			domain.ReleasePointer{Kind: domain.ReleasePointerKindIDP, Handle: "github", RevisionID: "idprev_github"},
		), "proj-1", []string{"google", "github"})
	require.ErrorIs(t, err, cause)
}
