//go:build postgres_integration || spanner_integration || sqlite_integration

package integration_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	api "go.zitadel.com/zitadel/v5/api"
)

func TestCreateApplication(t *testing.T) {
	t.Parallel()
	f := newApplicationFixture(t)

	shop := shopApplication(webClient("web", ""))
	created := f.create(t, shop)
	require.Len(t, created.ClientSecrets, 1)
	web := created.ClientSecrets[0]

	t.Run("a new slug creates the application and returns each client's secret once", func(t *testing.T) {
		assert.True(t, domain.PrefixApplication.Matches(created.ID), created.ID)
		assert.True(t, domain.PrefixApplicationRevision.Matches(created.RevisionID), created.RevisionID)
		assert.Equal(t, "web", web.Client)
		assert.True(t, domain.PrefixApplicationClient.Matches(web.ClientID), "a client without client_id gets a generated one: %s", web.ClientID)
		assert.True(t, strings.HasPrefix(web.Secret, "sk_client_"), web.Secret)
		assert.Equal(t, web.ClientID, created.Definition.Clients[0].ClientID.Value)
	})

	t.Run("only the hash of the secret is stored", func(t *testing.T) {
		stmts := harness.EnsureServiceDB(t).Statements()
		client, err := stmts.GetApplicationClientByClientID(t.Context(), f.project.ID, web.ClientID)
		require.NoError(t, err)
		secrets, err := stmts.ListApplicationClientSecrets(t.Context(), f.project.ID, client.ID)
		require.NoError(t, err)
		require.Len(t, secrets, 1)
		assert.Equal(t, domain.HashSecret(web.Secret), secrets[0].SecretHash)
	})

	// The stored client is sent back without its client_id: it keeps the one it has.
	shop = shopApplication(webClient("web", ""), webClient("admin", "shop-admin"))
	revised := f.revise(t, shop)

	t.Run("the same slug revises and only the new client gets a secret", func(t *testing.T) {
		assert.Equal(t, created.ID, revised.ID)
		assert.NotEqual(t, created.RevisionID, revised.RevisionID)
		assert.True(t, created.CreatedAt.Equal(revised.CreatedAt), "created_at comes from the application, not from the revision")
		require.Len(t, revised.ClientSecrets, 1)
		assert.Equal(t, "admin", revised.ClientSecrets[0].Client)
		assert.Equal(t, "shop-admin", revised.ClientSecrets[0].ClientID)
		assert.Equal(t, web.ClientID, revised.Definition.Clients[0].ClientID.Value)
	})

	t.Run("get returns the newest revision without secrets", func(t *testing.T) {
		resp := f.get(t, created.ID)
		require.IsType(t, &api.ApplicationResponse{}, resp, helpers.MustMarshal(t, resp))
		got := resp.(*api.ApplicationResponse)
		assert.Equal(t, revised.RevisionID, got.RevisionID)
		assert.JSONEq(t, helpers.MustMarshal(t, revised.Definition), helpers.MustMarshal(t, got.Definition))
	})

	t.Run("a revision that adds no client returns no secrets", func(t *testing.T) {
		again := f.revise(t, shop)
		assert.NotEqual(t, revised.RevisionID, again.RevisionID, "an unchanged document is a new revision")
		assert.Empty(t, again.ClientSecrets)
	})

	t.Run("removing a client is rejected and nothing is stored", func(t *testing.T) {
		before := f.get(t, created.ID).(*api.ApplicationResponse)

		resp := f.put(t, shopApplication(webClient("web", "")))
		require.IsType(t, &api.CreateApplicationBadRequest{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode(domain.ErrApplicationFieldImmutable(nil).Code), resp.(*api.CreateApplicationBadRequest).Code)

		after := f.get(t, created.ID).(*api.ApplicationResponse)
		assert.Equal(t, before.RevisionID, after.RevisionID)
	})

	t.Run("a client_id another application holds is client_id_taken", func(t *testing.T) {
		resp := f.put(t, api.Application{Slug: "blog", Name: "Blog", Clients: []api.ApplicationClient{webClient("web", "shop-admin")}})
		require.IsType(t, &api.CreateApplicationConflict{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode(domain.ErrApplicationClientIDTaken().Code), resp.(*api.CreateApplicationConflict).Code)
	})

	t.Run("an unknown id is app.not_found", func(t *testing.T) {
		assertAuthzError(t, f.get(t, "app_missing"), domain.ErrApplicationNotFound().Code)
	})

	t.Run("a rule of the authorization server is app.invalid", func(t *testing.T) {
		noRedirect := webClient("web", "")
		noRedirect.RedirectUris = nil
		resp := f.put(t, api.Application{Slug: "cli", Name: "CLI", Clients: []api.ApplicationClient{noRedirect}})
		require.IsType(t, &api.CreateApplicationBadRequest{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode(domain.ErrApplicationInvalid(nil, nil).Code), resp.(*api.CreateApplicationBadRequest).Code)
	})
}

func TestApplicationAccess(t *testing.T) {
	t.Parallel()
	owner := newApplicationFixture(t)
	app := owner.create(t, shopApplication(webClient("web", "")))

	t.Run("a caller without access to the project gets 404", func(t *testing.T) {
		outsider := newApplicationFixture(t)
		// The outsider's own secret, pointed at the owner's project.
		outsider.project = owner.project

		notFound := domain.ErrApplicationNotFound().Code
		assertAuthzError(t, outsider.put(t, shopApplication(webClient("web", ""))), notFound)
		assertAuthzError(t, outsider.get(t, app.ID), notFound)
	})

	t.Run("a viewer reads but cannot write", func(t *testing.T) {
		viewer := newApplicationFixture(t)
		own := viewer.create(t, shopApplication(webClient("web", "")))
		replaceSecretGrant(t, viewer.project, domain.NewProjectAssignmentScope())

		resp := viewer.get(t, own.ID)
		require.IsType(t, &api.ApplicationResponse{}, resp, helpers.MustMarshal(t, resp))

		denied := viewer.put(t, shopApplication(webClient("web", "")))
		require.IsType(t, &api.CreateApplicationForbidden{}, denied, helpers.MustMarshal(t, denied))
		assert.Equal(t, api.ErrorCode(domain.ErrApplicationPermissionDenied().Code), denied.(*api.CreateApplicationForbidden).Code)
	})

	t.Run("unauthenticated calls are rejected", func(t *testing.T) {
		anonymous, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		f := applicationFixture{project: owner.project, client: anonymous}

		unauthorized := domain.ErrAuthUnauthorized(nil).Code
		assertAuthzError(t, f.put(t, shopApplication(webClient("web", ""))), unauthorized)
		assertAuthzError(t, f.get(t, app.ID), unauthorized)
	})
}

// applicationFixture is a project, removed when the test ends, and a client
// holding that project's secret.
type applicationFixture struct {
	project *domain.Project
	client  *helpers.ApiClient
}

func newApplicationFixture(t *testing.T) applicationFixture {
	t.Helper()
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)
	return applicationFixture{project: project, client: client}
}

func (f applicationFixture) put(t *testing.T, app api.Application) api.CreateApplicationRes {
	t.Helper()
	resp, err := f.client.CreateApplication(t.Context(), &api.CreateApplicationRequest{Application: app}, api.CreateApplicationParams{ProjectID: api.ProjectID(f.project.ID)})
	require.NoError(t, err)
	return resp
}

func (f applicationFixture) create(t *testing.T, app api.Application) api.CreateApplicationResponse {
	t.Helper()
	resp := f.put(t, app)
	require.IsType(t, &api.CreateApplicationCreated{}, resp, helpers.MustMarshal(t, resp))
	return api.CreateApplicationResponse(*resp.(*api.CreateApplicationCreated))
}

func (f applicationFixture) revise(t *testing.T, app api.Application) api.CreateApplicationResponse {
	t.Helper()
	resp := f.put(t, app)
	require.IsType(t, &api.CreateApplicationOK{}, resp, helpers.MustMarshal(t, resp))
	return api.CreateApplicationResponse(*resp.(*api.CreateApplicationOK))
}

func (f applicationFixture) get(t *testing.T, id string) api.GetApplicationByIdRes {
	t.Helper()
	resp, err := f.client.GetApplicationById(t.Context(), api.GetApplicationByIdParams{ProjectID: api.ProjectID(f.project.ID), ID: id})
	require.NoError(t, err)
	return resp
}

func shopApplication(clients ...api.ApplicationClient) api.Application {
	return api.Application{Slug: "shop", Name: "Shop", Clients: clients}
}

// webClient is a confidential authorization_code client; an empty clientID
// leaves the id to the server.
func webClient(slug, clientID string) api.ApplicationClient {
	client := api.ApplicationClient{
		Slug:         slug,
		Type:         api.ApplicationClientTypeConfidential,
		GrantTypes:   []api.ApplicationClientGrantTypesItem{api.ApplicationClientGrantTypesItemAuthorizationCode},
		RedirectUris: []string{"https://" + slug + ".example.com/callback"},
	}
	if clientID != "" {
		client.ClientID = api.NewOptString(clientID)
	}
	return client
}
