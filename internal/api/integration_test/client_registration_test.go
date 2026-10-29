//go:build postgres_integration || spanner_integration

package integration_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// Clients register at the authorization server, which writes through the
// service; the API lists, reads and deletes what they registered.
func TestClientRegistrations_OverHTTP(t *testing.T) {
	f := newIdpFixture(t)
	registrations := service.NewClientRegistrationService(harness.EnsureServiceDB(t), service.NoConsents{})
	out, err := registrations.Register(t.Context(), service.RegisterClientInput{
		ProjectID: f.project.ID,
		Metadata: domain.ClientRegistrationMetadata{
			ClientName:   "Claude Code",
			LogoURI:      "https://claude.ai/logo.png",
			RedirectURIs: []string{"http://localhost:33418/callback"},
			AuthMethod:   domain.ClientAuthClientSecretPost,
		},
	})
	require.NoError(t, err)
	id := out.Registration.ID

	queried, err := f.client.QueryClientRegistrations(t.Context(), &api.QueryClientRegistrationsRequest{},
		api.QueryClientRegistrationsParams{ProjectID: f.projectID()})
	require.NoError(t, err)
	require.IsType(t, &api.QueryClientRegistrationsResponse{}, queried, helpers.MustMarshal(t, queried))
	listed := queried.(*api.QueryClientRegistrationsResponse).ClientRegistrations
	require.Len(t, listed, 1)
	assert.Equal(t, id, listed[0].ID)
	assert.Equal(t, "Claude Code", listed[0].ClientName.Or(""))
	assert.Equal(t, api.ClientRegistrationResponseTokenEndpointAuthMethodClientSecretPost, listed[0].TokenEndpointAuthMethod)
	assert.NotContains(t, helpers.MustMarshal(t, queried), out.Secret, "a read never shows the secret")

	got, err := f.client.GetClientRegistrationById(t.Context(), api.GetClientRegistrationByIdParams{ProjectID: f.projectID(), ID: id})
	require.NoError(t, err)
	require.IsType(t, &api.ClientRegistrationResponse{}, got, helpers.MustMarshal(t, got))
	assert.Equal(t, []string{"http://localhost:33418/callback"}, got.(*api.ClientRegistrationResponse).RedirectUris)

	// Another project's credentials do not reach the registration.
	other := newIdpFixture(t)
	missed, err := other.client.GetClientRegistrationById(t.Context(), api.GetClientRegistrationByIdParams{ProjectID: other.projectID(), ID: id})
	require.NoError(t, err)
	_, code, _, ok := errorResponseParts(t, missed)
	require.True(t, ok, helpers.MustMarshal(t, missed))
	assert.Equal(t, "app.client_registration_not_found", code)

	deleted, err := f.client.DeleteClientRegistration(t.Context(), api.DeleteClientRegistrationParams{ProjectID: f.projectID(), ID: id})
	require.NoError(t, err)
	require.IsType(t, &api.DeleteClientRegistrationNoContent{}, deleted, helpers.MustMarshal(t, deleted))

	again, err := f.client.DeleteClientRegistration(t.Context(), api.DeleteClientRegistrationParams{ProjectID: f.projectID(), ID: id})
	require.NoError(t, err)
	_, code, _, ok = errorResponseParts(t, again)
	require.True(t, ok, helpers.MustMarshal(t, again))
	assert.Equal(t, "app.client_registration_not_found", code)
}
