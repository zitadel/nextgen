//go:build postgres_integration || spanner_integration || sqlite_integration

package integration_test

import (
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	api "go.zitadel.com/zitadel/v5/api"
)

func TestPublishApplication(t *testing.T) {
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
		assert.Equal(t, api.NewOptBool(false), created.Definition.Clients[0].FirstParty, "a registered client is third-party by default")
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
		require.IsType(t, &api.PublishApplicationBadRequest{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode(domain.ErrApplicationFieldImmutable(nil).Code), resp.(*api.PublishApplicationBadRequest).Code)

		after := f.get(t, created.ID).(*api.ApplicationResponse)
		assert.Equal(t, before.RevisionID, after.RevisionID)
	})

	t.Run("a client_id another application holds is client_id_taken", func(t *testing.T) {
		resp := f.put(t, api.Application{Slug: "blog", Name: "Blog", Clients: []api.ApplicationClient{webClient("web", "shop-admin")}})
		require.IsType(t, &api.PublishApplicationConflict{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode(domain.ErrApplicationClientIDTaken().Code), resp.(*api.PublishApplicationConflict).Code)
	})

	t.Run("an unknown id is app.not_found", func(t *testing.T) {
		assertAuthzError(t, f.get(t, "app_missing"), domain.ErrApplicationNotFound().Code)
	})

	t.Run("a rule of the authorization server is app.invalid", func(t *testing.T) {
		noRedirect := webClient("web", "")
		noRedirect.RedirectUris = nil
		resp := f.put(t, api.Application{Slug: "cli", Name: "CLI", Clients: []api.ApplicationClient{noRedirect}})
		require.IsType(t, &api.PublishApplicationBadRequest{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode(domain.ErrApplicationInvalid(nil, nil).Code), resp.(*api.PublishApplicationBadRequest).Code)
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
		require.IsType(t, &api.PublishApplicationForbidden{}, denied, helpers.MustMarshal(t, denied))
		assert.Equal(t, api.ErrorCode(domain.ErrApplicationPermissionDenied().Code), denied.(*api.PublishApplicationForbidden).Code)
	})

	// The Console holds only its session cookie: the grant on the project is
	// what admits it, and a session without one learns nothing.
	t.Run("a signed-in project admin reads with their session", func(t *testing.T) {
		adminID, _ := harness.CreateUserOwnedByTeam(t, harness.EnsurePlatformProject(t).ID)
		harness.SeedProjectAdmin(t, owner.project.ID, adminID)
		admin := applicationFixture{project: owner.project, client: sessionClientForUser(t, adminID)}

		resp := admin.get(t, app.ID)
		require.IsType(t, &api.ApplicationResponse{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, app.ID, resp.(*api.ApplicationResponse).ID)
	})

	t.Run("a session without access to the project gets 404", func(t *testing.T) {
		strangerID, _ := harness.CreateUserOwnedByTeam(t, harness.EnsurePlatformProject(t).ID)
		stranger := applicationFixture{project: owner.project, client: sessionClientForUser(t, strangerID)}

		assertAuthzError(t, stranger.get(t, app.ID), domain.ErrApplicationNotFound().Code)
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

// TestPublishApplicationIdempotencyKey holds one case per acceptance
// criterion of #2923.
func TestPublishApplicationIdempotencyKey(t *testing.T) {
	t.Parallel()
	f := newApplicationFixture(t)
	stmts := harness.EnsureServiceDB(t).Statements()
	storedSecretHashes := func(t *testing.T, clientID string) []string {
		t.Helper()
		client, err := stmts.GetApplicationClientByClientID(t.Context(), f.project.ID, clientID)
		require.NoError(t, err)
		secrets, err := stmts.ListApplicationClientSecrets(t.Context(), f.project.ID, client.ID)
		require.NoError(t, err)
		hashes := make([]string, len(secrets))
		for i, secret := range secrets {
			hashes[i] = secret.SecretHash
		}
		return hashes
	}

	t.Run("a create sent twice with the same key and body returns new secrets and keeps the revision", func(t *testing.T) {
		keyed := f.withKey("create-twice")
		app := api.Application{Slug: "twice", Name: "Twice", Clients: []api.ApplicationClient{webClient("web", ""), webClient("admin", "")}}
		first := keyed.create(t, app)
		retry := keyed.create(t, app)

		assert.Equal(t, first.ID, retry.ID)
		assert.Equal(t, first.RevisionID, retry.RevisionID)
		require.Len(t, retry.ClientSecrets, 2)
		for i, secret := range retry.ClientSecrets {
			assert.Equal(t, first.ClientSecrets[i].ClientID, secret.ClientID)
			assert.NotEqual(t, first.ClientSecrets[i].Secret, secret.Secret)
			assert.Equal(t, []string{domain.HashSecret(secret.Secret)}, storedSecretHashes(t, secret.ClientID), "the first secret's hash is gone")
		}
		got := f.get(t, first.ID).(*api.ApplicationResponse)
		assert.Equal(t, first.RevisionID, got.RevisionID)
	})

	t.Run("two requests with the same key and body at the same time answer as one", func(t *testing.T) {
		app := api.Application{Slug: "parallel", Name: "Parallel", Clients: []api.ApplicationClient{webClient("web", ""), webClient("admin", "")}}
		params := api.PublishApplicationParams{ProjectID: api.ProjectID(f.project.ID), IdempotencyKey: api.NewOptString("parallel")}
		var (
			wg        sync.WaitGroup
			responses [2]api.PublishApplicationRes
			errs      [2]error
		)
		for i := range responses {
			wg.Go(func() {
				responses[i], errs[i] = f.client.PublishApplication(t.Context(), &api.CreateApplicationRequest{Application: app}, params)
			})
		}
		wg.Wait()

		var created [2]api.CreateApplicationResponse
		for i, resp := range responses {
			require.NoError(t, errs[i])
			require.IsType(t, &api.PublishApplicationCreated{}, resp, helpers.MustMarshal(t, resp))
			created[i] = api.CreateApplicationResponse(*resp.(*api.PublishApplicationCreated))
		}
		assert.Equal(t, created[0].ID, created[1].ID)
		got := f.get(t, created[0].ID).(*api.ApplicationResponse)
		assert.Equal(t, got.RevisionID, created[0].RevisionID)
		assert.Equal(t, got.RevisionID, created[1].RevisionID)
		require.Len(t, created[0].ClientSecrets, 2)
		require.Len(t, created[1].ClientSecrets, 2)
		for i, secret := range created[0].ClientSecrets {
			assert.Equal(t, secret.ClientID, created[1].ClientSecrets[i].ClientID)
			hashes := storedSecretHashes(t, secret.ClientID)
			require.Len(t, hashes, 1, "each client keeps one secret")
			assert.Contains(t, []string{domain.HashSecret(secret.Secret), domain.HashSecret(created[1].ClientSecrets[i].Secret)}, hashes[0])
		}
	})

	t.Run("a revision that adds a client, sent twice with the same key and body, returns the added client's secret", func(t *testing.T) {
		app := api.Application{Slug: "grow", Name: "Grow", Clients: []api.ApplicationClient{webClient("web", "")}}
		f.create(t, app)
		app.Clients = append(app.Clients, webClient("admin", ""))
		keyed := f.withKey("revise-twice")
		first := keyed.revise(t, app)
		retry := keyed.revise(t, app)

		assert.Equal(t, first.RevisionID, retry.RevisionID)
		require.Len(t, retry.ClientSecrets, 1)
		assert.Equal(t, "admin", retry.ClientSecrets[0].Client)
		assert.Equal(t, first.ClientSecrets[0].ClientID, retry.ClientSecrets[0].ClientID)
	})

	t.Run("a retry after a revision without the key returns that revision and the created clients' secrets", func(t *testing.T) {
		app := api.Application{Slug: "between", Name: "Between", Clients: []api.ApplicationClient{webClient("web", "")}}
		keyed := f.withKey("between")
		first := keyed.create(t, app)
		grown := app
		grown.Clients = append(slices.Clone(app.Clients), webClient("admin", ""))
		middle := f.revise(t, grown)
		retry := keyed.create(t, app)

		assert.Equal(t, first.ID, retry.ID)
		assert.Equal(t, middle.RevisionID, retry.RevisionID)
		require.Len(t, retry.ClientSecrets, 1)
		assert.Equal(t, first.ClientSecrets[0].ClientID, retry.ClientSecrets[0].ClientID)
	})

	t.Run("the same key with another body is refused and stores nothing", func(t *testing.T) {
		app := api.Application{Slug: "reused", Name: "Reused", Clients: []api.ApplicationClient{webClient("web", "")}}
		keyed := f.withKey("reused")
		first := keyed.create(t, app)
		app.Name = "Another name"

		resp := keyed.put(t, app)
		require.IsType(t, &api.PublishApplicationUnprocessableEntity{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode(domain.ErrApplicationIdempotencyKeyReused().Code), resp.(*api.PublishApplicationUnprocessableEntity).Code)
		got := f.get(t, first.ID).(*api.ApplicationResponse)
		assert.Equal(t, first.RevisionID, got.RevisionID)
	})

	t.Run("the same key and body after the window creates a revision and returns no secret", func(t *testing.T) {
		app := api.Application{Slug: "expired", Name: "Expired", Clients: []api.ApplicationClient{webClient("web", "")}}
		first := f.create(t, app)
		document, err := app.MarshalJSON()
		require.NoError(t, err)
		client, err := stmts.GetApplicationClientByClientID(t.Context(), f.project.ID, first.ClientSecrets[0].ClientID)
		require.NoError(t, err)
		// Seeded below the API, which only stores keys that expire later.
		firstRequest := time.Now().Add(-domain.ApplicationIdempotencyKeyTTL - time.Hour)
		require.NoError(t, stmts.CreateApplicationIdempotencyKey(t.Context(), &domain.ApplicationIdempotencyKey{
			ProjectID:     f.project.ID,
			KeyHash:       domain.HashSecret("expired"),
			RequestHash:   domain.HashSecret(string(document)),
			ApplicationID: first.ID,
			Created:       true,
			ClientIDs:     []string{client.ID},
			CreatedAt:     firstRequest,
			ExpiresAt:     firstRequest.Add(domain.ApplicationIdempotencyKeyTTL),
		}))

		revised := f.withKey("expired").revise(t, app)
		assert.NotEqual(t, first.RevisionID, revised.RevisionID)
		assert.Empty(t, revised.ClientSecrets)
	})
}

// applicationFixture is a project, removed when the test ends, and a client
// holding that project's secret. A non-empty key is sent as Idempotency-Key.
type applicationFixture struct {
	project *domain.Project
	client  *helpers.ApiClient
	key     string
}

func (f applicationFixture) withKey(key string) applicationFixture {
	f.key = key
	return f
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

func (f applicationFixture) put(t *testing.T, app api.Application) api.PublishApplicationRes {
	t.Helper()
	params := api.PublishApplicationParams{ProjectID: api.ProjectID(f.project.ID)}
	if f.key != "" {
		params.IdempotencyKey = api.NewOptString(f.key)
	}
	resp, err := f.client.PublishApplication(t.Context(), &api.CreateApplicationRequest{Application: app}, params)
	require.NoError(t, err)
	return resp
}

func (f applicationFixture) create(t *testing.T, app api.Application) api.CreateApplicationResponse {
	t.Helper()
	resp := f.put(t, app)
	require.IsType(t, &api.PublishApplicationCreated{}, resp, helpers.MustMarshal(t, resp))
	return api.CreateApplicationResponse(*resp.(*api.PublishApplicationCreated))
}

func (f applicationFixture) revise(t *testing.T, app api.Application) api.CreateApplicationResponse {
	t.Helper()
	resp := f.put(t, app)
	require.IsType(t, &api.PublishApplicationOK{}, resp, helpers.MustMarshal(t, resp))
	return api.CreateApplicationResponse(*resp.(*api.PublishApplicationOK))
}

func (f applicationFixture) get(t *testing.T, id string) api.GetApplicationRes {
	t.Helper()
	resp, err := f.client.GetApplication(t.Context(), api.GetApplicationParams{ProjectID: api.ProjectID(f.project.ID), ApplicationID: id})
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
