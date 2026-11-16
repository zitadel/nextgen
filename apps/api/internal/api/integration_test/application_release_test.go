//go:build postgres_integration || spanner_integration || sqlite_integration

package integration_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	api "go.zitadel.com/zitadel/v5/api"
)

// TestDeclaredApplication follows an application a release declares from its
// build to the deployment that serves it: the release is its one writer, a
// deploy needs the variable its secret names, and the client lookup reads the
// revision each deployment pins.
func TestDeclaredApplication(t *testing.T) {
	t.Parallel()
	f := newDeploymentFixture(t)

	shop := shopApplication(declaredClient("web", "shop-web", "SHOP_WEB_SECRET"))
	first := f.build(t, shop)
	require.IsType(t, &api.BuildReleaseCreated{}, first, helpers.MustMarshal(t, first))
	v1 := api.Release(*first.(*api.BuildReleaseCreated))
	require.Len(t, v1.Pointers, 1)
	assert.Equal(t, api.ReleasePointerKindApplication, v1.Pointers[0].Kind)
	assert.Equal(t, "shop", v1.Pointers[0].Handle)
	assert.True(t, domain.PrefixApplicationRevision.Matches(v1.Pointers[0].RevisionID), v1.Pointers[0].RevisionID)

	stored, err := harness.EnsureServiceDB(t).Statements().GetApplicationClientByClientID(t.Context(), f.project, "shop-web")
	require.NoError(t, err)

	t.Run("the application reads back as declared, its client_id as written", func(t *testing.T) {
		resp, err := f.client.GetApplicationById(t.Context(), api.GetApplicationByIdParams{ProjectID: api.ProjectID(f.project), ID: stored.ApplicationID})
		require.NoError(t, err)
		require.IsType(t, &api.ApplicationResponse{}, resp, helpers.MustMarshal(t, resp))
		app := resp.(*api.ApplicationResponse)
		assert.True(t, app.Declared)
		assert.Equal(t, v1.Pointers[0].RevisionID, app.RevisionID)
		assert.Equal(t, "shop-web", app.Definition.Clients[0].ClientID.Value)
	})

	t.Run("the revision the release pins reads back by its id", func(t *testing.T) {
		resp, err := f.client.GetApplicationRevisionById(t.Context(), api.GetApplicationRevisionByIdParams{ProjectID: api.ProjectID(f.project), RevisionID: v1.Pointers[0].RevisionID})
		require.NoError(t, err)
		require.IsType(t, &api.ApplicationResponse{}, resp, helpers.MustMarshal(t, resp))
		app := resp.(*api.ApplicationResponse)
		assert.Equal(t, stored.ApplicationID, app.ID)
		assert.True(t, app.Declared)
		assert.Equal(t, "${{ SHOP_WEB_SECRET }}", app.Definition.Clients[0].Secret.Value)

		missing, err := f.client.GetApplicationRevisionById(t.Context(), api.GetApplicationRevisionByIdParams{ProjectID: api.ProjectID(f.project), RevisionID: "apprev_unknown"})
		require.NoError(t, err)
		require.IsType(t, &api.GetApplicationRevisionByIdNotFound{}, missing, helpers.MustMarshal(t, missing))
		assert.Equal(t, api.ErrorCode(domain.ErrApplicationNotFound().Code), missing.(*api.GetApplicationRevisionByIdNotFound).Code)
	})

	t.Run("the same files build the same release", func(t *testing.T) {
		again := f.build(t, shop)
		require.IsType(t, &api.BuildReleaseOK{}, again, helpers.MustMarshal(t, again))
		assert.Equal(t, v1.ID, api.Release(*again.(*api.BuildReleaseOK)).ID)
	})

	t.Run("the API may not revise a declared application", func(t *testing.T) {
		resp, err := f.client.CreateApplication(t.Context(), &api.CreateApplicationRequest{Application: shopApplication(webClient("web", ""))},
			api.CreateApplicationParams{ProjectID: api.ProjectID(f.project)})
		require.NoError(t, err)
		require.IsType(t, &api.CreateApplicationConflict{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode(domain.ErrApplicationDeclared().Code), resp.(*api.CreateApplicationConflict).Code)
	})

	t.Run("a deploy is refused while the secret's variable has no value", func(t *testing.T) {
		refused := f.deploy(t, v1.ID)
		require.IsType(t, &api.CreateDeploymentBadRequest{}, refused, helpers.MustMarshal(t, refused))
		missing, ok := refused.(*api.CreateDeploymentBadRequest).GetDeploymentVariablesMissing()
		require.True(t, ok, helpers.MustMarshal(t, refused))
		assert.Equal(t, []string{"SHOP_WEB_SECRET"}, missing.Details.Names)
	})

	f.setPrimaryVariables(t, api.UpdateVariablesRequest{
		"SHOP_WEB_SECRET": api.NewSecretVariableInputVariableInput(api.SecretVariableInput{
			Value:  api.NewStringVariableScalar("s3cr3t"),
			Secret: true,
		}),
	})
	deployedV1 := f.deploy(t, v1.ID)
	require.IsType(t, &api.CreateDeploymentCreated{}, deployedV1, helpers.MustMarshal(t, deployedV1))
	servedByV1 := f.servedBy(t, string(deployedV1.(*api.CreateDeploymentCreated).ID))
	applications := harness.EnsureApplicationService(t)

	t.Run("the deployment authenticates the client against the variable", func(t *testing.T) {
		served, err := applications.AuthenticateClient(servedByV1, f.project, "shop-web", "s3cr3t")
		require.NoError(t, err)
		assert.Equal(t, "web", served.Document.Slug)

		_, err = applications.AuthenticateClient(servedByV1, f.project, "shop-web", "guess")
		assert.ErrorIs(t, err, domain.ErrApplicationClientSecretInvalid())
	})

	moved := shopApplication(declaredClient("web", "shop-web", "SHOP_WEB_SECRET"))
	moved.Clients[0].RedirectUris = []string{"https://shop.example.com/auth/callback"}
	second := f.build(t, moved)
	require.IsType(t, &api.BuildReleaseCreated{}, second, helpers.MustMarshal(t, second))
	v2 := api.Release(*second.(*api.BuildReleaseCreated))

	t.Run("each deployment serves the revision its release pins", func(t *testing.T) {
		assert.NotEqual(t, v1.Pointers[0].RevisionID, v2.Pointers[0].RevisionID)
		served, err := applications.Client(servedByV1, f.project, "shop-web")
		require.NoError(t, err)
		assert.Equal(t, v1.Pointers[0].RevisionID, served.Application.RevisionID)
		assert.Equal(t, []string{"https://web.example.com/callback"}, served.Document.RedirectURIs)

		deployedV2 := f.deploy(t, v2.ID)
		require.IsType(t, &api.CreateDeploymentCreated{}, deployedV2, helpers.MustMarshal(t, deployedV2))
		served, err = applications.Client(f.servedBy(t, string(deployedV2.(*api.CreateDeploymentCreated).ID)), f.project, "shop-web")
		require.NoError(t, err)
		assert.Equal(t, []string{"https://shop.example.com/auth/callback"}, served.Document.RedirectURIs)
	})

	t.Run("a deployment whose release does not pin the application does not serve its client", func(t *testing.T) {
		deployed := f.deploy(t, f.release.ID)
		require.IsType(t, &api.CreateDeploymentCreated{}, deployed, helpers.MustMarshal(t, deployed))
		_, err := applications.Client(f.servedBy(t, string(deployed.(*api.CreateDeploymentCreated).ID)), f.project, "shop-web")
		assert.ErrorIs(t, err, domain.ErrApplicationClientNotFound())
	})

	withAPI := shopApplication(declaredClient("web", "shop-web", "SHOP_WEB_SECRET"), declaredClient("api", "shop-api", "SHOP_API_SECRET"))
	added := f.build(t, withAPI)
	require.IsType(t, &api.BuildReleaseCreated{}, added, helpers.MustMarshal(t, added))

	t.Run("a release may drop a client an earlier build added", func(t *testing.T) {
		dropped := f.build(t, moved)
		require.IsType(t, &api.BuildReleaseCreated{}, dropped, helpers.MustMarshal(t, dropped))
	})

	t.Run("a dropped client keeps its client_id and its variable", func(t *testing.T) {
		renamed := shopApplication(declaredClient("web", "shop-web", "SHOP_WEB_SECRET"), declaredClient("api", "shop-api-2", "SHOP_API_SECRET"))
		blog := api.Application{Slug: "blog", Name: "Blog", Clients: []api.ApplicationClient{declaredClient("web", "blog-web", "SHOP_API_SECRET")}}
		refused := f.build(t, renamed, blog)
		require.IsType(t, &api.BuildReleaseBadRequest{}, refused, helpers.MustMarshal(t, refused))
		resources := refused.(*api.BuildReleaseBadRequest).Details.Value.Resources
		require.Len(t, resources, 4, helpers.MustMarshal(t, refused))
		// The bundle's two clients naming one variable are both refused.
		assert.Equal(t, api.ErrorCode(domain.ErrApplicationInvalid(nil, nil).Code), resources[0].Code)
		assert.Equal(t, 0, resources[0].Index)
		assert.JSONEq(t, `{"/clients/1/secret":"another client in the release names this variable"}`, string(resources[0].Details.Value["details"]))
		assert.Equal(t, 1, resources[1].Index)
		assert.JSONEq(t, `{"/clients/0/secret":"another client in the release names this variable"}`, string(resources[1].Details.Value["details"]))
		assert.Equal(t, 0, resources[2].Index)
		assert.Equal(t, api.ErrorCode(domain.ErrApplicationFieldImmutable(nil).Code), resources[2].Code)
		assert.Equal(t, 1, resources[3].Index)
		assert.JSONEq(t, `{"/clients/0/secret":"another client in the project names this variable"}`, string(resources[3].Details.Value["details"]))

		alone := f.build(t, blog)
		require.IsType(t, &api.BuildReleaseBadRequest{}, alone, helpers.MustMarshal(t, alone))
		resources = alone.(*api.BuildReleaseBadRequest).Details.Value.Resources
		require.Len(t, resources, 1, helpers.MustMarshal(t, alone))
		assert.Equal(t, api.ErrorCode(domain.ErrApplicationInvalid(nil, nil).Code), resources[0].Code)
		assert.JSONEq(t, `{"/clients/0/secret":"another client in the project names this variable"}`, string(resources[0].Details.Value["details"]),
			"a variable stays the client's that first named it, though no release serves that client")
	})
}

// TestDeclaredApplicationDeployVariables covers which variables a deploy
// needs of a declared application: only its clients' secrets, each stored as
// a secret.
func TestDeclaredApplicationDeployVariables(t *testing.T) {
	t.Parallel()
	f := newDeploymentFixture(t)

	blog := api.Application{Slug: "blog", Name: "Blog ${{ BRAND }}", Clients: []api.ApplicationClient{declaredClient("web", "blog-web", "BLOG_WEB_SECRET")}}
	built := f.build(t, blog)
	require.IsType(t, &api.BuildReleaseCreated{}, built, helpers.MustMarshal(t, built))
	release := api.Release(*built.(*api.BuildReleaseCreated))

	f.setPrimaryVariables(t, api.UpdateVariablesRequest{
		"BLOG_WEB_SECRET": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("s3cr3t")),
	})
	refused := f.deploy(t, release.ID)
	require.IsType(t, &api.CreateDeploymentBadRequest{}, refused, helpers.MustMarshal(t, refused))
	plain, ok := refused.(*api.CreateDeploymentBadRequest).GetDeploymentVariablesNotSecret()
	require.True(t, ok, helpers.MustMarshal(t, refused))
	assert.Equal(t, []string{"BLOG_WEB_SECRET"}, plain.Details.Names)

	f.setPrimaryVariables(t, api.UpdateVariablesRequest{
		"BLOG_WEB_SECRET": api.NewSecretVariableInputVariableInput(api.SecretVariableInput{
			Value:  api.NewStringVariableScalar("s3cr3t"),
			Secret: true,
		}),
	})
	deployed := f.deploy(t, release.ID)
	require.IsType(t, &api.CreateDeploymentCreated{}, deployed, helpers.MustMarshal(t, deployed),
		"a ${{ NAME }} outside a client's secret is served as written and needs no variable")
}

// TestRegisteredApplicationClient finds a registered client at its
// application's newest revision, whatever release the request resolved, and
// authenticates it against the secret the API returned once.
func TestRegisteredApplicationClient(t *testing.T) {
	t.Parallel()
	f := newApplicationFixture(t)
	created := f.create(t, shopApplication(webClient("web", "")))
	require.Len(t, created.ClientSecrets, 1)
	web := created.ClientSecrets[0]
	applications := harness.EnsureApplicationService(t)

	served, err := applications.AuthenticateClient(t.Context(), f.project.ID, web.ClientID, web.Secret)
	require.NoError(t, err)
	assert.Equal(t, created.RevisionID, served.Application.RevisionID)

	_, err = applications.AuthenticateClient(t.Context(), f.project.ID, web.ClientID, "guess")
	assert.ErrorIs(t, err, domain.ErrApplicationClientSecretInvalid())
	_, err = applications.Client(t.Context(), f.project.ID, "unknown")
	assert.ErrorIs(t, err, domain.ErrApplicationClientNotFound())
}

// TestDeclaredApplicationRefusals covers what a release build refuses of the
// applications it declares, each named by its entry in the bundle.
func TestDeclaredApplicationRefusals(t *testing.T) {
	t.Parallel()
	f := newDeploymentFixture(t)

	registered, err := f.client.CreateApplication(t.Context(), &api.CreateApplicationRequest{
		Application: api.Application{Slug: "crm", Name: "CRM", Clients: []api.ApplicationClient{webClient("web", "crm-web")}},
	}, api.CreateApplicationParams{ProjectID: api.ProjectID(f.project)})
	require.NoError(t, err)
	require.IsType(t, &api.CreateApplicationCreated{}, registered, helpers.MustMarshal(t, registered))

	type refusal struct {
		index   int
		code    string
		details string
	}
	tests := []struct {
		name         string
		applications []api.Application
		want         []refusal
	}{
		{
			name:         "a slug the API registered",
			applications: []api.Application{{Slug: "crm", Name: "CRM", Clients: []api.ApplicationClient{declaredClient("web", "crm-web", "CRM_WEB_SECRET")}}},
			want:         []refusal{{code: domain.ErrApplicationRegistered().Code}},
		},
		{
			name:         "a client without its client_id or the variable holding its secret",
			applications: []api.Application{shopApplication(webClient("web", ""))},
			want: []refusal{{
				code:    domain.ErrApplicationInvalid(nil, nil).Code,
				details: `{"/clients/0/client_id":"a client declared in a release sets its client_id","/clients/0/secret":"a confidential client declared in a release names the variable holding its secret"}`,
			}},
		},
		{
			name:         "a client_id a registered client holds",
			applications: []api.Application{shopApplication(declaredClient("web", "crm-web", "SHOP_WEB_SECRET"))},
			want:         []refusal{{code: domain.ErrApplicationClientIDTaken().Code, details: `{"client_id":"crm-web"}`}},
		},
		{
			name: "a client_id and a variable another application in the release has, on both sides",
			applications: []api.Application{
				shopApplication(declaredClient("web", "shop-web", "SHOP_WEB_SECRET")),
				{Slug: "blog", Name: "Blog", Clients: []api.ApplicationClient{declaredClient("web", "shop-web", "SHOP_WEB_SECRET")}},
			},
			want: []refusal{
				{index: 0, code: domain.ErrApplicationInvalid(nil, nil).Code, details: `{"/clients/0/client_id":"another client in the release has this client_id","/clients/0/secret":"another client in the release names this variable"}`},
				{index: 1, code: domain.ErrApplicationInvalid(nil, nil).Code, details: `{"/clients/0/client_id":"another client in the release has this client_id","/clients/0/secret":"another client in the release names this variable"}`},
			},
		},
		{
			name: "every refusal of an application at once",
			applications: []api.Application{
				shopApplication(declaredClient("web", "crm-web", "SHARED_SECRET")),
				{Slug: "blog", Name: "Blog", Clients: []api.ApplicationClient{declaredClient("web", "blog-web", "SHARED_SECRET")}},
			},
			want: []refusal{
				{index: 0, code: domain.ErrApplicationInvalid(nil, nil).Code, details: `{"/clients/0/secret":"another client in the release names this variable"}`},
				{index: 1, code: domain.ErrApplicationInvalid(nil, nil).Code, details: `{"/clients/0/secret":"another client in the release names this variable"}`},
				{index: 0, code: domain.ErrApplicationClientIDTaken().Code, details: `{"client_id":"crm-web"}`},
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			refused := f.build(t, tt.applications...)
			require.IsType(t, &api.BuildReleaseBadRequest{}, refused, helpers.MustMarshal(t, refused))
			resources := refused.(*api.BuildReleaseBadRequest).Details.Value.Resources
			require.Len(t, resources, len(tt.want), helpers.MustMarshal(t, refused))
			for i, want := range tt.want {
				assert.Equal(t, api.ReleasePointerKindApplication, resources[i].Kind)
				assert.Equal(t, want.index, resources[i].Index)
				assert.Equal(t, tt.applications[want.index].Slug, resources[i].Handle.Value)
				assert.Equal(t, api.ErrorCode(want.code), resources[i].Code)
				if want.details != "" {
					assert.JSONEq(t, want.details, string(resources[i].Details.Value["details"]))
				}
			}
		})
	}
}

func (f deploymentFixture) build(t *testing.T, applications ...api.Application) api.BuildReleaseRes {
	t.Helper()
	resp, err := f.client.BuildRelease(t.Context(), &api.BuildReleaseRequest{
		Bundle: api.ConfigurationBundle{Applications: applications},
	}, api.BuildReleaseParams{ProjectID: api.ProjectID(f.project)})
	require.NoError(t, err)
	return resp
}

// servedBy is a context resolved to deploymentID, as a request to its origin
// would be.
func (f deploymentFixture) servedBy(t *testing.T, deploymentID string) context.Context {
	t.Helper()
	stmts := harness.EnsureServiceDB(t).Statements()
	deployment, err := stmts.GetDeploymentByID(t.Context(), f.project, deploymentID)
	require.NoError(t, err)
	release, err := stmts.GetReleaseByID(t.Context(), f.project, deployment.ReleaseID)
	require.NoError(t, err)
	return service.WithRuntimeResolution(t.Context(), &service.RuntimeResolution{Deployment: deployment, Release: release})
}

// declaredClient is webClient as a release declares it: with its client_id
// and the variable holding its secret.
func declaredClient(slug, clientID, variable string) api.ApplicationClient {
	client := webClient(slug, clientID)
	client.Secret = api.NewOptString("${{ " + variable + " }}")
	return client
}
