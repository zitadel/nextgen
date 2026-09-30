package service_test

import (
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
	connections.EXPECT().GetBySlug(gomock.Any(), "proj-1", "google").
		Return(&domain.IDPConnection{Slug: "google", Document: []byte(`{"display_name":"Google","template":"google"}`)}, nil)
	connections.EXPECT().GetBySlug(gomock.Any(), "proj-1", "gone").
		Return(nil, domain.ErrIDPConnectionNotFound())
	connections.EXPECT().GetBySlug(gomock.Any(), "proj-1", "github").
		Return(&domain.IDPConnection{Slug: "github", Document: []byte(`{"display_name":"GitHub"}`)}, nil)

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
	connections.EXPECT().GetBySlug(gomock.Any(), "proj-1", "google").Return(nil, cause)

	_, err := service.NewFlowSSOProviderResolver(connections).
		Resolve(t.Context(), "proj-1", "identifier", []string{"google", "github"})
	require.ErrorIs(t, err, domain.ErrInternal(cause))
}
