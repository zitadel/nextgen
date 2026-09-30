package api

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

type stubIDPConnections struct {
	service.IDPConnectionService
	items []*domain.IDPConnection
	err   error
}

func (s stubIDPConnections) List(context.Context, service.ListIDPConnectionsInput) (*service.ListIDPConnectionsOutput, error) {
	if s.err != nil {
		return nil, s.err
	}
	return &service.ListIDPConnectionsOutput{Items: s.items}, nil
}

func connection(slug, document string) *domain.IDPConnection {
	return &domain.IDPConnection{Slug: slug, Document: []byte(document)}
}

func stepOffering(slugs ...string) *domain.FlowStep {
	providers := make([]domain.FlowSSOProvider, 0, len(slugs))
	for _, slug := range slugs {
		providers = append(providers, domain.FlowSSOProvider{ID: slug})
	}
	return &domain.FlowStep{Name: "identifier", SSOProviders: providers}
}

func TestResolveSSOProvidersFillsNameAndTemplateFromTheConnection(t *testing.T) {
	h := &Handler{idpConnectionService: stubIDPConnections{items: []*domain.IDPConnection{
		connection("google", `{"display_name":"Google","template":"google"}`),
	}}}
	step := stepOffering("google")

	h.resolveSSOProviders(context.Background(), "proj", step)

	require.Len(t, step.SSOProviders, 1)
	assert.Equal(t, domain.FlowSSOProvider{ID: "google", Name: "Google", Template: "google"}, step.SSOProviders[0])
}

// The flow definition and the connections are edited separately, so a step can
// outlive the connection it names. A button that cannot start a sign-in is
// worse than no button.
func TestResolveSSOProvidersDropsASlugWithNoConnection(t *testing.T) {
	h := &Handler{idpConnectionService: stubIDPConnections{items: []*domain.IDPConnection{
		connection("google", `{"display_name":"Google","template":"google"}`),
	}}}
	step := stepOffering("google", "retired")

	h.resolveSSOProviders(context.Background(), "proj", step)

	require.Len(t, step.SSOProviders, 1)
	assert.Equal(t, "google", step.SSOProviders[0].ID)
}

func TestResolveSSOProvidersKeepsTheOrderTheFlowOffers(t *testing.T) {
	h := &Handler{idpConnectionService: stubIDPConnections{items: []*domain.IDPConnection{
		connection("acme", `{"display_name":"Acme"}`),
		connection("google", `{"display_name":"Google"}`),
	}}}
	step := stepOffering("google", "acme")

	h.resolveSSOProviders(context.Background(), "proj", step)

	require.Len(t, step.SSOProviders, 2)
	assert.Equal(t, "google", step.SSOProviders[0].ID)
	assert.Equal(t, "acme", step.SSOProviders[1].ID)
}

// A blank label is an unusable button, and the slug is what the project called
// the connection.
func TestResolveSSOProvidersFallsBackToTheSlugWhenUnnamed(t *testing.T) {
	h := &Handler{idpConnectionService: stubIDPConnections{items: []*domain.IDPConnection{
		connection("acme-sso", `{"protocol":"oidc"}`),
	}}}
	step := stepOffering("acme-sso")

	h.resolveSSOProviders(context.Background(), "proj", step)

	require.Len(t, step.SSOProviders, 1)
	assert.Equal(t, "acme-sso", step.SSOProviders[0].Name)
	assert.Empty(t, step.SSOProviders[0].Template)
}

// The rest of the step is still a usable sign-in; taking the page down over
// the buttons would turn a degraded provider list into an outage.
func TestResolveSSOProvidersDropsThemAllWhenTheLookupFails(t *testing.T) {
	h := &Handler{idpConnectionService: stubIDPConnections{err: errors.New("unavailable")}}
	step := stepOffering("google")

	h.resolveSSOProviders(context.Background(), "proj", step)

	assert.Nil(t, step.SSOProviders)
}

func TestResolveSSOProvidersLeavesAStepThatOffersNoneAlone(t *testing.T) {
	h := &Handler{idpConnectionService: stubIDPConnections{}}
	step := &domain.FlowStep{Name: "password"}

	h.resolveSSOProviders(context.Background(), "proj", step)

	assert.Nil(t, step.SSOProviders)
}
