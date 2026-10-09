package service_test

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/mock/gomock"

	"github.com/zitadel/zitadel/v5/internal/domain"
	"github.com/zitadel/zitadel/v5/internal/service"
	servicemocks "github.com/zitadel/zitadel/v5/internal/service/mocks"
)

func TestFlowSSOProviderResolver_Resolve_DropsUnknownSlugsKeepsOrder(t *testing.T) {
	t.Parallel()
	ctrl := gomock.NewController(t)
	connections := servicemocks.NewMockIDPConnectionService(ctrl)
	// Storage order is unspecified, so the mock answers out of step order.
	connections.EXPECT().GetBySlugs(gomock.Any(), "proj-1", []string{"google", "gone", "github"}).
		Return([]*domain.IDPConnection{
			{Slug: "github", Document: []byte(`{"display_name":"GitHub"}`)},
			{Slug: "google", Document: []byte(`{"display_name":"Google","template":"google"}`)},
		}, nil)

	got, err := service.NewFlowSSOProviderResolver(connections).
		Resolve(t.Context(), "proj-1", "identifier", []string{"google", "gone", "github"})
	require.NoError(t, err)
	assert.Equal(t, []domain.FlowSSOProvider{
		{ID: "google", Name: "Google", Template: "google"},
		{ID: "github", Name: "GitHub"},
	}, got)
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
