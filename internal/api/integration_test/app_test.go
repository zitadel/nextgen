//go:build postgres_integration || spanner_integration

package integration_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/service"
)

// appDocument decodes a document the way the API takes it.
func appDocument(t *testing.T, raw string) api.App {
	t.Helper()
	var app api.App
	require.NoError(t, app.UnmarshalJSON([]byte(raw)))
	return app
}

const shopAppDocument = `{"slug":"shop","name":"Shop","clients":[
  {"slug":"web","type":"confidential","grants":["authorization_code"],"redirect_uris":["https://shop.example.com/cb"],"apis":[{"api":"orders"}]},
  {"slug":"desktop","client_id":"ShopDesktop","type":"public","grants":["authorization_code"],"redirect_uris":["http://127.0.0.1/cb"]}],
  "apis":[{"slug":"orders","identifier":"https://api.shop.example.com","scopes":[{"name":"orders.read"}]}]}`

func TestApps_RegisteredAppOverHTTP(t *testing.T) {
	f := newIdpFixture(t)
	params := api.CreateAppParams{ProjectID: f.projectID()}

	resp, err := f.client.CreateApp(t.Context(), &api.CreateAppRequest{App: appDocument(t, shopAppDocument)}, params)
	require.NoError(t, err)
	require.IsType(t, &api.CreateAppCreated{}, resp, helpers.MustMarshal(t, resp))
	created := api.AppResponse(*resp.(*api.CreateAppCreated))
	assert.Equal(t, api.AppResponseSourceRegistered, created.Source)
	require.Len(t, created.Clients, 2)
	assert.True(t, strings.HasPrefix(created.Clients[0].ClientID, "client_"))
	assert.Equal(t, "ShopDesktop", created.Clients[1].ClientID)
	require.Len(t, created.ClientSecrets, 1, "the confidential client's secret, shown once")
	assert.Equal(t, "web", created.ClientSecrets[0].Client)

	got, err := f.client.GetAppById(t.Context(), api.GetAppByIdParams{ProjectID: f.projectID(), ID: created.ID})
	require.NoError(t, err)
	require.IsType(t, &api.AppResponse{}, got, helpers.MustMarshal(t, got))
	assert.Equal(t, created.Clients, got.(*api.AppResponse).Clients)
	assert.Empty(t, got.(*api.AppResponse).ClientSecrets, "a read never shows a secret")

	queried, err := f.client.QueryApps(t.Context(), &api.QueryAppsRequest{Filter: []api.QueryAppsRequestFilterItem{{
		Field:     api.AppFilterFieldSlug,
		Operation: api.FilterOperationEquals,
		Value:     api.NewOptFilterValue(api.NewStringFilterValue("shop")),
	}}}, api.QueryAppsParams{ProjectID: f.projectID()})
	require.NoError(t, err)
	require.IsType(t, &api.QueryAppsResponse{}, queried, helpers.MustMarshal(t, queried))
	require.Len(t, queried.(*api.QueryAppsResponse).Apps, 1)

	revised, err := f.client.CreateApp(t.Context(), &api.CreateAppRequest{
		App: appDocument(t, strings.Replace(shopAppDocument, `"name":"Shop"`, `"name":"Shop 2"`, 1)),
	}, params)
	require.NoError(t, err)
	require.IsType(t, &api.CreateAppOK{}, revised, helpers.MustMarshal(t, revised))
	assert.Equal(t, created.Clients, revised.(*api.CreateAppOK).Clients)

	secret, err := f.client.AddAppClientSecret(t.Context(), &api.AddAppClientSecretRequest{}, api.AddAppClientSecretParams{
		ProjectID: f.projectID(), ID: created.ID, Client: "web",
	})
	require.NoError(t, err)
	require.IsType(t, &api.AddAppClientSecretResponse{}, secret, helpers.MustMarshal(t, secret))
	assert.True(t, secret.(*api.AddAppClientSecretResponse).Secret.IsSet())
}

func TestApps_DeclaredAppRefusesTheAPI(t *testing.T) {
	f := newIdpFixture(t)
	_, err := harness.EnsureReleaseService(t).Build(t.Context(), service.BuildReleaseInput{
		ProjectID: f.project.ID,
		Apps: []service.BuildApp{{Index: 0, Document: []byte(
			`{"slug":"portal","name":"Portal","clients":[{"slug":"spa","type":"public","grants":["authorization_code"],"redirect_uris":["https://portal.example.com/cb"]}]}`,
		)}},
	})
	require.NoError(t, err)

	resp, err := f.client.CreateApp(t.Context(), &api.CreateAppRequest{App: appDocument(t, `{"slug":"portal","name":"Mine"}`)},
		api.CreateAppParams{ProjectID: f.projectID()})
	require.NoError(t, err)
	_, code, _, ok := errorResponseParts(t, resp)
	require.True(t, ok, helpers.MustMarshal(t, resp))
	assert.Equal(t, "app.declared", code)
}
