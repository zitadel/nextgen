//go:build postgres_integration || spanner_integration

package integration_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/api/integration_test/test_data"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// TestConsoleManagementAcceptsSession pins #1300 §1: the embedded Console
// holds only __nextgen_session, so every management operation its screens
// call must accept that cookie as the signed-in user. The caller holds a
// direct admin grant on the platform project it signed in to, so home and
// target project are the same -- the single-project deployment. (The owning
// team slot of the shared platform project is TestTeamReadsAcceptSession's.)
func TestConsoleManagementAcceptsSession(t *testing.T) {
	t.Parallel()

	console := harness.EnsurePlatformProject(t)
	claimerID, _ := harness.CreateUserOwnedByTeam(t, console.ID)
	harness.SeedProjectAdmin(t, console.ID, claimerID)

	session := sessionClientForUser(t, claimerID)
	projectID := api.ProjectID(console.ID)

	t.Run("schemas", func(t *testing.T) {
		t.Parallel()
		resp, err := session.ListSchemas(t.Context(), api.ListSchemasParams{ProjectID: projectID})
		require.NoError(t, err)
		listed, ok := resp.(*api.ListSchemasResponse)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		require.NotEmpty(t, listed.Schemas, "the platform project is seeded with defaults")

		got, err := session.GetSchemaById(t.Context(), api.GetSchemaByIdParams{ID: listed.Schemas[0].ID})
		require.NoError(t, err)
		require.IsType(t, &api.Schema{}, got, helpers.MustMarshal(t, got))
	})

	t.Run("flow definitions", func(t *testing.T) {
		t.Parallel()
		resp, err := session.ListFlowDefinitions(t.Context(), api.ListFlowDefinitionsParams{ProjectID: projectID})
		require.NoError(t, err)
		listed, ok := resp.(*api.FlowDefinitionListResponse)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		require.NotEmpty(t, listed.FlowDefinitions, "the platform project is seeded with defaults")

		got, err := session.GetFlowDefinition(t.Context(), api.GetFlowDefinitionParams{ID: listed.FlowDefinitions[0].ID})
		require.NoError(t, err)
		require.IsType(t, &api.FlowDefinitionResponse{}, got, helpers.MustMarshal(t, got))
	})

	t.Run("branding", func(t *testing.T) {
		t.Parallel()
		// Branding is not seeded, and creating it stays secret-only.
		secret, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetProjectSecretOnApiClient(t, secret, console)
		created, err := secret.CreateBranding(t.Context(), &api.Branding{
			Layout: api.NewOptBrandingLayout(api.BrandingLayoutSplit),
		}, api.CreateBrandingParams{ProjectID: projectID})
		require.NoError(t, err)
		revision, ok := created.(*api.BrandingRevisionResponse)
		require.True(t, ok, helpers.MustMarshal(t, created))

		resp, err := session.ListBranding(t.Context(), api.ListBrandingParams{ProjectID: projectID})
		require.NoError(t, err)
		listed, ok := resp.(*api.ListBrandingResponse)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		require.True(t, slices.ContainsFunc(*listed, func(item api.ListBrandingResponseItem) bool {
			return item.ID == revision.ID
		}), helpers.MustMarshal(t, listed))

		got, err := session.GetBrandingById(t.Context(), api.GetBrandingByIdParams{ID: revision.ID})
		require.NoError(t, err)
		require.IsType(t, &api.BrandingRevisionResponse{}, got, helpers.MustMarshal(t, got))
	})

	t.Run("identity providers", func(t *testing.T) {
		t.Parallel()
		// Connections are created with the secret only (#998). The platform
		// project is shared, so the slug is this test's own.
		secret, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetProjectSecretOnApiClient(t, secret, console)
		created := idpFixture{project: console, client: secret}.create(t, helpers.OIDCConnection(strings.ToLower(claimerID)))

		read := idpFixture{project: console, client: session}
		require.Contains(t, idpIDs(read.queryOK(t, &api.QueryIdpsRequest{}).Idps), created.ID)
		got := read.get(t, created.ID)
		require.IsType(t, &api.IdpResponse{}, got, helpers.MustMarshal(t, got))
		revision, err := session.GetIdpRevisionById(t.Context(), api.GetIdpRevisionByIdParams{ProjectID: api.ProjectID(console.ID), RevisionID: created.RevisionID})
		require.NoError(t, err)
		require.IsType(t, &api.IdpResponse{}, revision, helpers.MustMarshal(t, revision))
	})

	t.Run("releases", func(t *testing.T) {
		t.Parallel()
		// Releases are built with the secret only; the session reads them.
		// There is no release delete, so the release lives in a project of
		// this test's own and goes with it.
		owned, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
		require.NoError(t, err)
		harness.SeedProjectAdmin(t, owned.ID, claimerID)
		ownedID := api.ProjectID(owned.ID)
		secret, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetProjectSecretOnApiClient(t, secret, owned)
		created := seedRelease(t, secret, owned.ID)

		listed, err := session.ListReleases(t.Context(), api.ListReleasesParams{ProjectID: ownedID})
		require.NoError(t, err)
		require.IsType(t, &api.ListReleasesResponse{}, listed, helpers.MustMarshal(t, listed))
		require.Contains(t, releaseIDs(listed.(*api.ListReleasesResponse).Releases), created.ID)

		got, err := session.GetReleaseById(t.Context(), api.GetReleaseByIdParams{ProjectID: ownedID, ReleaseID: created.ID})
		require.NoError(t, err)
		require.IsType(t, &api.Release{}, got, helpers.MustMarshal(t, got))

		// The session deploys too: the Deploy release drawer posts with it.
		_, err = harness.EnsureProjectService(t).AddOrigin(t.Context(), owned.ID,
			domain.Origin{Pattern: "https://console-session.example.com", Kind: domain.OriginKindPrimary})
		require.NoError(t, err)
		deployed, err := session.CreateDeployment(t.Context(), &api.CreateDeploymentRequest{
			ReleaseID: api.NewOptReleaseID(created.ID),
			Targets:   api.DeploymentTargetsRequest{"primary"},
		}, api.CreateDeploymentParams{ProjectID: ownedID})
		require.NoError(t, err)
		require.IsType(t, &api.CreateDeploymentCreated{}, deployed, helpers.MustMarshal(t, deployed))

		// The directory embeds each deployment's release to know whether it is
		// revoked: the session's project-wide read stands in for release.read.
		history, err := session.ListDeployments(t.Context(), api.ListDeploymentsParams{
			ProjectID: ownedID, Expand: []api.DeploymentExpand{api.DeploymentExpandRelease},
		})
		require.NoError(t, err)
		require.IsType(t, &api.ListDeploymentsResponse{}, history, helpers.MustMarshal(t, history))
		require.NotEmpty(t, history.(*api.ListDeploymentsResponse).Deployments)
		assert.Equal(t, created.ID, history.(*api.ListDeploymentsResponse).Deployments[0].Release.Value.ID)

		// And rolls back: to the deployment that is live, which changes
		// nothing and answers 200.
		rolledBack, err := session.RollbackDeployment(t.Context(), api.OptRollbackDeploymentRequest{},
			api.RollbackDeploymentParams{ProjectID: ownedID, DeploymentID: deployed.(*api.CreateDeploymentCreated).ID})
		require.NoError(t, err)
		require.IsType(t, &api.RollbackDeploymentOK{}, rolledBack, helpers.MustMarshal(t, rolledBack))

		// And revokes: the origin just deployed to still serves the release,
		// so the answer is the typed refusal, past the authentication.
		revoked, err := session.RevokeRelease(t.Context(), api.RevokeReleaseParams{ProjectID: ownedID, ReleaseID: created.ID})
		require.NoError(t, err)
		require.IsType(t, &api.RevokeReleaseConflict{}, revoked, helpers.MustMarshal(t, revoked))
	})

	t.Run("policies", func(t *testing.T) {
		t.Parallel()
		// The Project settings page reads the password policy and the release
		// detail a pinned revision with the session; publishing stays with the
		// secret. A policy is project state, so the project is this test's own.
		owned, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
		require.NoError(t, err)
		harness.SeedProjectAdmin(t, owned.ID, claimerID)
		ownedID := api.ProjectID(owned.ID)
		secret, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetProjectSecretOnApiClient(t, secret, owned)
		published := passwordSetPolicy(t, publishPolicy(t, secret, owned.ID, api.PasswordSetConfig{MinLength: api.NewOptInt(12)}))

		listed, err := session.ListPolicies(t.Context(), api.ListPoliciesParams{
			ProjectID: ownedID, Operation: api.NewOptPolicyOperation(passwordSetOperation),
		})
		require.NoError(t, err)
		require.IsType(t, &api.ListPoliciesResponse{}, listed, helpers.MustMarshal(t, listed))
		require.Len(t, listed.(*api.ListPoliciesResponse).Policies, 1)
		assert.Equal(t, published.ID, passwordSetPolicy(t, &listed.(*api.ListPoliciesResponse).Policies[0]).ID)

		got, err := session.GetPolicy(t.Context(), api.GetPolicyParams{ProjectID: ownedID, PolicyID: published.ID})
		require.NoError(t, err)
		assert.Equal(t, published.RevisionID, passwordSetPolicy(t, got).RevisionID)

		revisions, err := session.ListPolicyRevisions(t.Context(), api.ListPolicyRevisionsParams{ProjectID: ownedID, PolicyID: published.ID})
		require.NoError(t, err)
		require.IsType(t, &api.ListPolicyRevisionsResponse{}, revisions, helpers.MustMarshal(t, revisions))

		revision, err := session.GetPolicyRevision(t.Context(), api.GetPolicyRevisionParams{ProjectID: ownedID, RevisionID: published.RevisionID})
		require.NoError(t, err)
		assert.Equal(t, published.ID, passwordSetPolicy(t, revision).ID)
	})

	t.Run("origins and variables", func(t *testing.T) {
		t.Parallel()
		// The Project settings page adds and removes origins and reads the
		// variables with the session (#2320). Variables are written with the
		// secret only. The project is this test's own: origins and variables
		// are project state, and the platform project is shared.
		owned, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
		require.NoError(t, err)
		harness.SeedProjectAdmin(t, owned.ID, claimerID)
		ownedID := api.ProjectID(owned.ID)
		secret, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetProjectSecretOnApiClient(t, secret, owned)

		origin := api.ProjectOrigin{Pattern: "https://console-session-origin.example.com", Kind: api.ProjectOriginKindPrimary}
		added, err := session.AddOrigin(t.Context(), &origin, api.AddOriginParams{ProjectID: ownedID})
		require.NoError(t, err)
		require.IsType(t, &api.AddOriginResponse{}, added, helpers.MustMarshal(t, added))
		project, err := session.GetProject(t.Context(), api.GetProjectParams{ProjectID: ownedID})
		require.NoError(t, err)
		require.IsType(t, &api.ProjectDetailResponse{}, project, helpers.MustMarshal(t, project))
		require.Contains(t, project.(*api.ProjectDetailResponse).Origins, origin)

		removed, err := session.RemoveOrigin(t.Context(), &api.RemoveOriginReq{Pattern: origin.Pattern}, api.RemoveOriginParams{ProjectID: ownedID})
		require.NoError(t, err)
		require.IsType(t, &api.RemoveOriginNoContent{}, removed, helpers.MustMarshal(t, removed))
		project, err = session.GetProject(t.Context(), api.GetProjectParams{ProjectID: ownedID})
		require.NoError(t, err)
		require.NotContains(t, project.(*api.ProjectDetailResponse).Origins, origin)

		written, err := secret.UpdateVariables(t.Context(), api.UpdateVariablesRequest{
			"SESSION_PLAIN": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("shown")),
			"SESSION_SECRET": api.NewSecretVariableInputVariableInput(api.SecretVariableInput{
				Value: api.NewStringVariableScalar("never-shown"), Secret: true,
			}),
		}, api.UpdateVariablesParams{ProjectID: ownedID})
		require.NoError(t, err)
		require.IsType(t, &api.VariablesByKind{}, written, helpers.MustMarshal(t, written))

		// The session reads every name with its value per kind, the secret held.
		held := api.NewSecretVariableVariable(api.SecretVariable{Secret: true})
		listed, err := session.GetVariables(t.Context(), api.GetVariablesParams{ProjectID: ownedID})
		require.NoError(t, err)
		require.IsType(t, &api.VariablesByKind{}, listed, helpers.MustMarshal(t, listed))
		variables := *listed.(*api.VariablesByKind)
		assert.Equal(t, api.NewVariableScalarVariable(api.NewStringVariableScalar("shown")), variables["SESSION_PLAIN"].Primary.Value)
		assert.Equal(t, held, variables["SESSION_SECRET"].Primary.Value)
		assert.NotContains(t, helpers.MustMarshal(t, listed), "never-shown")

		one, err := session.GetVariable(t.Context(), api.GetVariableParams{ProjectID: ownedID, VariableName: "SESSION_SECRET"})
		require.NoError(t, err)
		require.IsType(t, &api.VariableByKind{}, one, helpers.MustMarshal(t, one))
		assert.Equal(t, api.VariableByKind{Primary: api.NewOptVariable(held)}, *one.(*api.VariableByKind))
	})

	t.Run("teams", func(t *testing.T) {
		t.Parallel()
		created, err := session.CreateTeam(t.Context(), &api.CreateTeamRequest{Name: helpers.TeamName()},
			api.CreateTeamParams{ProjectID: projectID})
		require.NoError(t, err)
		team, ok := created.(*api.TeamResponse)
		require.True(t, ok, helpers.MustMarshal(t, created))

		renamed := helpers.TeamName()
		updated, err := session.UpdateTeam(t.Context(),
			&api.UpdateTeamRequest{Name: api.NewOptString(renamed)},
			api.UpdateTeamParams{TeamID: api.TeamID(team.ID)})
		require.NoError(t, err)
		got, ok := updated.(*api.TeamResponse)
		require.True(t, ok, helpers.MustMarshal(t, updated))
		require.Equal(t, renamed, got.Name)
	})

	t.Run("users", func(t *testing.T) {
		t.Parallel()
		req := &api.CreateUserRequest{}
		require.NoError(t, req.UnmarshalJSON([]byte(helpers.MustMarshal(t, map[string]any{
			"schema": test_data.UserSchemaURL,
			"attributes": map[string]any{
				"email":    fmt.Sprintf("console-session-%s@example.com", claimerID),
				"password": "my-strong-password",
			},
		}))))
		created, err := session.CreateUser(t.Context(), req, api.CreateUserParams{ProjectID: projectID})
		require.NoError(t, err)
		user, ok := created.(*api.User)
		require.True(t, ok, helpers.MustMarshal(t, created))

		got, err := session.GetUserByID(t.Context(), api.GetUserByIDParams{UserID: user.ID})
		require.NoError(t, err)
		require.IsType(t, &api.User{}, got, helpers.MustMarshal(t, got))

		password, err := session.GetUserPasswordState(t.Context(), api.GetUserPasswordStateParams{UserID: user.ID})
		require.NoError(t, err)
		require.IsType(t, &api.UserPasswordState{}, password, helpers.MustMarshal(t, password))

		patched, err := session.PatchUserByID(t.Context(), patchUserRequest(t, map[string]any{
			"attributes": map[string]any{"nickname": "Patched"},
		}), api.PatchUserByIDParams{UserID: user.ID})
		require.NoError(t, err)
		require.IsType(t, &api.User{}, patched, helpers.MustMarshal(t, patched))
		assert.Equal(t, "Patched", userProp(t, *patched.(*api.User), "nickname"))

		deleted, err := session.DeleteUserByID(t.Context(), api.DeleteUserByIDParams{UserID: user.ID})
		require.NoError(t, err)
		require.IsType(t, &api.DeleteUserByIDNoContent{}, deleted, helpers.MustMarshal(t, deleted))
	})

	// Editor is the least PATCH asks for; the admin grant above would also
	// pass a check that wrongly asked for admin.
	t.Run("an editor patches a user", func(t *testing.T) {
		t.Parallel()
		edited, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
		require.NoError(t, err)
		harness.SeedProjectEditor(t, edited.ID, claimerID)
		targetID, _ := harness.CreateUserOwnedByTeam(t, edited.ID)

		resp, err := session.PatchUserByID(t.Context(), patchUserRequest(t, map[string]any{
			"attributes": map[string]any{"nickname": "Patched"},
		}), api.PatchUserByIDParams{UserID: api.UserID(targetID)})
		require.NoError(t, err)
		require.IsType(t, &api.User{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, "Patched", userProp(t, *resp.(*api.User), "nickname"))
	})
}

// TestConsoleManagementSessionWithoutAccess pins the other half: accepting
// the cookie is not authorizing it. A signed-in user with no grant on a
// project neither reads nor writes there, and gets the not-found shape rather
// than a 401 (the cookie was accepted) or a 403 (there is no foothold).
func TestConsoleManagementSessionWithoutAccess(t *testing.T) {
	t.Parallel()

	console := harness.EnsurePlatformProject(t)
	strangerID, _ := harness.CreateUserOwnedByTeam(t, console.ID)
	session := sessionClientForUser(t, strangerID)

	other, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	otherID := api.ProjectID(other.ID)

	t.Run("cannot list another project's schemas", func(t *testing.T) {
		resp, err := session.ListSchemas(t.Context(), api.ListSchemasParams{ProjectID: otherID})
		require.NoError(t, err)
		require.IsType(t, &api.ListSchemasErrorResponseStatusCode{}, resp, helpers.MustMarshal(t, resp))
		denied := resp.(*api.ListSchemasErrorResponseStatusCode)
		assert.Equal(t, http.StatusNotFound, denied.StatusCode)
		assert.True(t, denied.Response.IsSchNotFound(), helpers.MustMarshal(t, resp))
	})

	t.Run("cannot list another project's flow definitions", func(t *testing.T) {
		resp, err := session.ListFlowDefinitions(t.Context(), api.ListFlowDefinitionsParams{ProjectID: otherID})
		require.NoError(t, err)
		require.IsType(t, &api.ListFlowDefinitionsErrorResponseStatusCode{}, resp, helpers.MustMarshal(t, resp))
		denied := resp.(*api.ListFlowDefinitionsErrorResponseStatusCode)
		assert.Equal(t, http.StatusNotFound, denied.StatusCode)
		assert.True(t, denied.Response.IsFlowdefNotFound(), helpers.MustMarshal(t, resp))
	})

	t.Run("cannot list another project's branding", func(t *testing.T) {
		resp, err := session.ListBranding(t.Context(), api.ListBrandingParams{ProjectID: otherID})
		require.NoError(t, err)
		require.IsType(t, &api.ListBrandingErrorResponseStatusCode{}, resp, helpers.MustMarshal(t, resp))
		denied := resp.(*api.ListBrandingErrorResponseStatusCode)
		assert.Equal(t, http.StatusNotFound, denied.StatusCode)
		assert.True(t, denied.Response.IsBrndNotFound(), helpers.MustMarshal(t, resp))
	})

	t.Run("cannot create a team in another project", func(t *testing.T) {
		resp, err := session.CreateTeam(t.Context(), &api.CreateTeamRequest{Name: helpers.TeamName()},
			api.CreateTeamParams{ProjectID: otherID})
		require.NoError(t, err)
		require.IsType(t, &api.CreateTeamNotFound{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode("team.project_not_found"), resp.(*api.CreateTeamNotFound).Code)
	})

	t.Run("cannot read another project's user", func(t *testing.T) {
		foreignUserID, _ := harness.CreateUserOwnedByTeam(t, other.ID)
		resp, err := session.GetUserByID(t.Context(), api.GetUserByIDParams{UserID: api.UserID(foreignUserID)})
		require.NoError(t, err)
		require.IsType(t, &api.GetUserByIDNotFound{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode("user.not_found"), resp.(*api.GetUserByIDNotFound).Code)

		passkeys, err := session.ListUserPasskeys(t.Context(), api.ListUserPasskeysParams{UserID: api.UserID(foreignUserID)})
		require.NoError(t, err)
		require.IsType(t, &api.ListUserPasskeysNotFound{}, passkeys, helpers.MustMarshal(t, passkeys))

		password, err := session.GetUserPasswordState(t.Context(), api.GetUserPasswordStateParams{UserID: api.UserID(foreignUserID)})
		require.NoError(t, err)
		require.IsType(t, &api.GetUserPasswordStateNotFound{}, password, helpers.MustMarshal(t, password))
		assert.Equal(t, api.ErrorCode("user.not_found"), password.(*api.GetUserPasswordStateNotFound).Code)

		links, err := session.ListUserIdentityLinks(t.Context(), api.ListUserIdentityLinksParams{UserID: api.UserID(foreignUserID)})
		require.NoError(t, err)
		require.IsType(t, &api.ListUserIdentityLinksNotFound{}, links, helpers.MustMarshal(t, links))
		assert.Equal(t, api.ErrorCode("user.not_found"), links.(*api.ListUserIdentityLinksNotFound).Code)
	})

	// The by-id operations resolve the path id before authorizing, so each is
	// pinned too: a foreign resource must stay the not-found shape.
	foreignUserID, foreignTeamID := harness.CreateUserOwnedByTeam(t, other.ID)
	otherSecret, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, otherSecret, other)

	t.Run("cannot delete another project's user", func(t *testing.T) {
		resp, err := session.DeleteUserByID(t.Context(), api.DeleteUserByIDParams{UserID: api.UserID(foreignUserID)})
		require.NoError(t, err)
		require.IsType(t, &api.DeleteUserByIDNotFound{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode("user.not_found"), resp.(*api.DeleteUserByIDNotFound).Code)
	})

	t.Run("cannot patch another project's user", func(t *testing.T) {
		// Its own target: the delete above must not decide this answer.
		targetID, _ := harness.CreateUserOwnedByTeam(t, other.ID)
		resp, err := session.PatchUserByID(t.Context(), patchUserRequest(t, map[string]any{
			"attributes": map[string]any{"nickname": "Patched"},
		}), api.PatchUserByIDParams{UserID: api.UserID(targetID)})
		require.NoError(t, err)
		require.IsType(t, &api.PatchUserByIDNotFound{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode("user.not_found"), resp.(*api.PatchUserByIDNotFound).Code)
	})

	// A viewer finds the user, so the refusal is the write check, not not-found.
	t.Run("a viewer cannot patch a user", func(t *testing.T) {
		viewed, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
		require.NoError(t, err)
		harness.SeedProjectViewer(t, viewed.ID, strangerID)
		targetID, _ := harness.CreateUserOwnedByTeam(t, viewed.ID)

		resp, err := session.PatchUserByID(t.Context(), patchUserRequest(t, map[string]any{
			"attributes": map[string]any{"nickname": "Patched"},
		}), api.PatchUserByIDParams{UserID: api.UserID(targetID)})
		require.NoError(t, err)
		require.IsType(t, &api.PatchUserByIDForbidden{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode("user.permission_denied"), resp.(*api.PatchUserByIDForbidden).Code)
	})

	t.Run("cannot update another project's team", func(t *testing.T) {
		resp, err := session.UpdateTeam(t.Context(), &api.UpdateTeamRequest{Name: api.NewOptString(helpers.TeamName())},
			api.UpdateTeamParams{TeamID: api.TeamID(foreignTeamID)})
		require.NoError(t, err)
		require.IsType(t, &api.UpdateTeamNotFound{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode("team.team_not_found"), resp.(*api.UpdateTeamNotFound).Code)
	})

	t.Run("cannot query or read another project's identity providers", func(t *testing.T) {
		owner := idpFixture{project: other, client: otherSecret}
		connection := owner.create(t, helpers.OIDCConnection("google"))

		notFound := api.ErrorCode(domain.ErrIDPConnectionNotFound().Code)
		stranger := idpFixture{project: other, client: session}
		listed := stranger.query(t, &api.QueryIdpsRequest{})
		require.IsType(t, &api.QueryIdpsNotFound{}, listed, helpers.MustMarshal(t, listed))
		assert.Equal(t, notFound, listed.(*api.QueryIdpsNotFound).Code)
		got := stranger.get(t, connection.ID)
		require.IsType(t, &api.GetIdpByIdNotFound{}, got, helpers.MustMarshal(t, got))
		assert.Equal(t, notFound, got.(*api.GetIdpByIdNotFound).Code)
	})

	t.Run("cannot list or read another project's releases", func(t *testing.T) {
		created := seedRelease(t, otherSecret, other.ID)

		listed, err := session.ListReleases(t.Context(), api.ListReleasesParams{ProjectID: otherID})
		require.NoError(t, err)
		status, code, _, ok := errorResponseParts(t, listed)
		require.True(t, ok, "unexpected response shape: %s", helpers.MustMarshal(t, listed))
		assert.Equal(t, http.StatusNotFound, status)
		// Both reads are filtered by the caller's projects and answer as an
		// unknown release does: no existence oracle on the project either.
		assert.Equal(t, domain.ErrReleaseNotFound().Code, code)

		got, err := session.GetReleaseById(t.Context(), api.GetReleaseByIdParams{ProjectID: otherID, ReleaseID: created.ID})
		require.NoError(t, err)
		status, code, _, ok = errorResponseParts(t, got)
		require.True(t, ok, "unexpected response shape: %s", helpers.MustMarshal(t, got))
		assert.Equal(t, http.StatusNotFound, status)
		assert.Equal(t, domain.ErrReleaseNotFound().Code, code)

		// Nor deploy there: the write stops at the project, as not found.
		deployed, err := session.CreateDeployment(t.Context(), &api.CreateDeploymentRequest{
			ReleaseID: api.NewOptReleaseID(created.ID),
			Targets:   api.DeploymentTargetsRequest{"primary"},
		}, api.CreateDeploymentParams{ProjectID: otherID})
		require.NoError(t, err)
		require.IsType(t, &api.CreateDeploymentNotFound{}, deployed, helpers.MustMarshal(t, deployed))
		assert.Equal(t, api.ErrorCode(domain.ErrEnvironmentProjectNotFound().Code), deployed.(*api.CreateDeploymentNotFound).Code)

		// Nor roll back or revoke there.
		rolledBack, err := session.RollbackDeployment(t.Context(), api.OptRollbackDeploymentRequest{},
			api.RollbackDeploymentParams{ProjectID: otherID, DeploymentID: "dep_01KX4SB9C8E1F0N9WD3P2E4YM5"})
		require.NoError(t, err)
		assertAuthzError(t, rolledBack, domain.ErrEnvironmentProjectNotFound().Code)
		revoked, err := session.RevokeRelease(t.Context(), api.RevokeReleaseParams{ProjectID: otherID, ReleaseID: created.ID})
		require.NoError(t, err)
		assertAuthzError(t, revoked, domain.ErrReleaseProjectNotFound().Code)
	})

	t.Run("cannot add or remove another project's origins, nor read its variables", func(t *testing.T) {
		// Every op is project-scoped: the miss is the resource's own not
		// found, which says nothing about the project.
		added, err := session.AddOrigin(t.Context(), &api.ProjectOrigin{
			Pattern: "https://stranger.example.com", Kind: api.ProjectOriginKindPrimary,
		}, api.AddOriginParams{ProjectID: otherID})
		require.NoError(t, err)
		assertAuthzError(t, added, domain.ErrOriginNotFound().Code)
		removed, err := session.RemoveOrigin(t.Context(), &api.RemoveOriginReq{Pattern: "https://stranger.example.com"}, api.RemoveOriginParams{ProjectID: otherID})
		require.NoError(t, err)
		assertAuthzError(t, removed, domain.ErrOriginNotFound().Code)

		listed, err := session.GetVariables(t.Context(), api.GetVariablesParams{ProjectID: otherID})
		require.NoError(t, err)
		assertAuthzError(t, listed, domain.ErrVariableNotFound().Code)
		one, err := session.GetVariable(t.Context(), api.GetVariableParams{ProjectID: otherID, VariableName: "ANY"})
		require.NoError(t, err)
		assertAuthzError(t, one, domain.ErrVariableNotFound().Code)
	})

	t.Run("cannot read another project's schema", func(t *testing.T) {
		// A managed sch_* id, unique to the other project: the seeded default
		// carries the same $id in every project, which is a different question.
		schemaJSON := []byte(harness.EnsureTestData(t).Schemas.CreateSchemaRequestUserSchema)
		var schemaObj map[string]any
		require.NoError(t, json.Unmarshal(schemaJSON, &schemaObj))
		delete(schemaObj, "$id")
		schemaJSON, err := json.Marshal(schemaObj)
		require.NoError(t, err)
		schemaID := harness.CreateUserSchema(t, other, string(schemaJSON))

		resp, err := session.GetSchemaById(t.Context(), api.GetSchemaByIdParams{ID: schemaID})
		require.NoError(t, err)
		require.IsType(t, &api.GetSchemaByIdErrorResponseStatusCode{}, resp, helpers.MustMarshal(t, resp))
		denied := resp.(*api.GetSchemaByIdErrorResponseStatusCode)
		assert.Equal(t, http.StatusNotFound, denied.StatusCode)
		assert.True(t, denied.Response.IsSchNotFound(), helpers.MustMarshal(t, resp))
	})

	t.Run("cannot read another project's flow definition", func(t *testing.T) {
		listed, err := otherSecret.ListFlowDefinitions(t.Context(), api.ListFlowDefinitionsParams{ProjectID: otherID})
		require.NoError(t, err)
		flows, ok := listed.(*api.FlowDefinitionListResponse)
		require.True(t, ok, helpers.MustMarshal(t, listed))
		require.NotEmpty(t, flows.FlowDefinitions)

		resp, err := session.GetFlowDefinition(t.Context(), api.GetFlowDefinitionParams{ID: flows.FlowDefinitions[0].ID})
		require.NoError(t, err)
		require.IsType(t, &api.GetFlowDefinitionErrorResponseStatusCode{}, resp, helpers.MustMarshal(t, resp))
		denied := resp.(*api.GetFlowDefinitionErrorResponseStatusCode)
		assert.Equal(t, http.StatusNotFound, denied.StatusCode)
		assert.True(t, denied.Response.IsFlowdefNotFound(), helpers.MustMarshal(t, resp))
	})

	t.Run("cannot read another project's branding", func(t *testing.T) {
		created, err := otherSecret.CreateBranding(t.Context(), &api.Branding{
			Layout: api.NewOptBrandingLayout(api.BrandingLayoutSplit),
		}, api.CreateBrandingParams{ProjectID: otherID})
		require.NoError(t, err)
		revision, ok := created.(*api.BrandingRevisionResponse)
		require.True(t, ok, helpers.MustMarshal(t, created))

		resp, err := session.GetBrandingById(t.Context(), api.GetBrandingByIdParams{ID: revision.ID})
		require.NoError(t, err)
		require.IsType(t, &api.ErrorDetails{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode("brnd.not_found"), resp.(*api.ErrorDetails).Code)
	})
}

// TestConsoleSessionListsTargetProject pins #1300 §2: a platform
// operator signs in to the platform project and manages a customer project
// through a grant, so home and target differ. `project_id` on queryUsers names
// the target; without it the home project is listed, as before.
func TestConsoleSessionListsTargetProject(t *testing.T) {
	t.Parallel()

	console := harness.EnsurePlatformProject(t)
	operatorID, _ := harness.CreateUserOwnedByTeam(t, console.ID)

	customer, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	harness.SeedProjectAdmin(t, customer.ID, operatorID)
	customerUserID, _ := harness.CreateUserOwnedByTeam(t, customer.ID)

	session := sessionClientForUser(t, operatorID)
	target := api.QueryUsersParams{ProjectID: api.NewOptProjectID(api.ProjectID(customer.ID))}

	t.Run("lists the customer project's users", func(t *testing.T) {
		t.Parallel()
		resp, err := session.QueryUsers(t.Context(), &api.QueryUsersRequest{}, target)
		require.NoError(t, err)
		listed, ok := resp.(*api.QueryUsersResponse)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		ids := make([]string, 0, len(listed.Users))
		for _, item := range listed.Users {
			ids = append(ids, userID(t, item))
		}
		require.Contains(t, ids, customerUserID)
		require.NotContains(t, ids, operatorID, "the operator is homed in the platform project")
	})

	// The other list screens already took project_id; with #1300 §1 they
	// accept the cookie too, so the whole screen set follows the selection.
	t.Run("lists the customer project's schemas", func(t *testing.T) {
		t.Parallel()
		resp, err := session.ListSchemas(t.Context(), api.ListSchemasParams{ProjectID: api.ProjectID(customer.ID)})
		require.NoError(t, err)
		listed, ok := resp.(*api.ListSchemasResponse)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		require.NotEmpty(t, listed.Schemas)
	})

	t.Run("a project secret stays bound to its own project", func(t *testing.T) {
		t.Parallel()
		secret, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetProjectSecretOnApiClient(t, secret, console)

		resp, err := secret.QueryUsers(t.Context(), &api.QueryUsersRequest{}, target)
		require.NoError(t, err)
		requireUsersNotFound(t, resp)
	})

	t.Run("without a grant the target is not listed", func(t *testing.T) {
		t.Parallel()
		strangerID, _ := harness.CreateUserOwnedByTeam(t, console.ID)
		stranger := sessionClientForUser(t, strangerID)
		resp, err := stranger.QueryUsers(t.Context(), &api.QueryUsersRequest{}, target)
		require.NoError(t, err)
		requireUsersNotFound(t, resp)
	})
}

// TestConsoleSessionReadsTargetProjectByID pins #1300 §3: a platform operator
// opens a customer project's resources by id. The id is looked up across
// projects for a user principal, and the Check runs against the resource's own
// project — so the grant on the customer project is what allows it, and a
// caller without one still gets the not-found shape.
func TestConsoleSessionReadsTargetProjectByID(t *testing.T) {
	t.Parallel()

	console := harness.EnsurePlatformProject(t)
	operatorID, _ := harness.CreateUserOwnedByTeam(t, console.ID)

	customer, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	harness.SeedProjectAdmin(t, customer.ID, operatorID)
	customerUserID, customerTeamID := harness.CreateUserOwnedByTeam(t, customer.ID)

	customerSecret, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, customerSecret, customer)

	session := sessionClientForUser(t, operatorID)
	customerProjectID := api.ProjectID(customer.ID)

	t.Run("user", func(t *testing.T) {
		t.Parallel()
		resp, err := session.GetUserByID(t.Context(), api.GetUserByIDParams{UserID: api.UserID(customerUserID)})
		require.NoError(t, err)
		require.IsType(t, &api.User{}, resp, helpers.MustMarshal(t, resp))

		// The user detail page's Authentication tab reads the passkeys and the
		// linked provider accounts too.
		passkeys, err := session.ListUserPasskeys(t.Context(), api.ListUserPasskeysParams{UserID: api.UserID(customerUserID)})
		require.NoError(t, err)
		require.IsType(t, &api.ListUserPasskeysResponse{}, passkeys, helpers.MustMarshal(t, passkeys))
		links, err := session.ListUserIdentityLinks(t.Context(), api.ListUserIdentityLinksParams{UserID: api.UserID(customerUserID)})
		require.NoError(t, err)
		require.IsType(t, &api.ListUserIdentityLinksResponse{}, links, helpers.MustMarshal(t, links))
	})

	t.Run("policies", func(t *testing.T) {
		t.Parallel()
		// The console shows a project's policies read-only (#898); the
		// project's own credentials publish them.
		published := passwordSetPolicy(t, publishPolicy(t, customerSecret, customer.ID, api.PasswordSetConfig{MinLength: api.NewOptInt(12)}))

		list, err := session.ListPolicies(t.Context(), api.ListPoliciesParams{ProjectID: customerProjectID})
		require.NoError(t, err)
		require.IsType(t, &api.ListPoliciesResponse{}, list, helpers.MustMarshal(t, list))
		require.Len(t, list.(*api.ListPoliciesResponse).Policies, 1)

		got, err := session.GetPolicy(t.Context(), api.GetPolicyParams{ProjectID: customerProjectID, PolicyID: published.ID})
		require.NoError(t, err)
		assert.Equal(t, published.RevisionID, passwordSetPolicy(t, got).RevisionID)

		revisions, err := session.ListPolicyRevisions(t.Context(), api.ListPolicyRevisionsParams{ProjectID: customerProjectID, PolicyID: published.ID})
		require.NoError(t, err)
		require.IsType(t, &api.ListPolicyRevisionsResponse{}, revisions, helpers.MustMarshal(t, revisions))
		assert.Len(t, revisions.(*api.ListPolicyRevisionsResponse).Revisions, 1)

		revision, err := session.GetPolicyRevision(t.Context(), api.GetPolicyRevisionParams{ProjectID: customerProjectID, RevisionID: published.RevisionID})
		require.NoError(t, err)
		assert.Equal(t, published.RevisionID, passwordSetPolicy(t, revision).RevisionID)

		// Publishing stays with the project's credentials: a policy is
		// authored as a file and applied, so publish does not take the
		// session, even with the CSRF token the console would send.
		status, body := consoleCall(t, platformSessionCookie(t, operatorID), http.MethodPost,
			"/policies?project_id="+customer.ID,
			`{"operation": "auth.factor.password.set", "config": {"min_length": 1}}`)
		assert.Equal(t, http.StatusUnauthorized, status, body)
		got, err = session.GetPolicy(t.Context(), api.GetPolicyParams{ProjectID: customerProjectID, PolicyID: published.ID})
		require.NoError(t, err)
		assert.Equal(t, published.RevisionID, passwordSetPolicy(t, got).RevisionID, "the session published nothing")
	})

	t.Run("team read and update", func(t *testing.T) {
		t.Parallel()
		resp, err := session.GetTeam(t.Context(), api.GetTeamParams{TeamID: api.TeamID(customerTeamID)})
		require.NoError(t, err)
		require.IsType(t, &api.TeamResponse{}, resp, helpers.MustMarshal(t, resp))

		renamed := helpers.TeamName()
		updated, err := session.UpdateTeam(t.Context(), &api.UpdateTeamRequest{Name: api.NewOptString(renamed)},
			api.UpdateTeamParams{TeamID: api.TeamID(customerTeamID)})
		require.NoError(t, err)
		got, ok := updated.(*api.TeamResponse)
		require.True(t, ok, helpers.MustMarshal(t, updated))
		require.Equal(t, renamed, got.Name)
	})

	t.Run("user delete", func(t *testing.T) {
		t.Parallel()
		doomedID, _ := harness.CreateUserOwnedByTeam(t, customer.ID)
		resp, err := session.DeleteUserByID(t.Context(), api.DeleteUserByIDParams{UserID: api.UserID(doomedID)})
		require.NoError(t, err)
		require.IsType(t, &api.DeleteUserByIDNoContent{}, resp, helpers.MustMarshal(t, resp))
	})

	t.Run("schema", func(t *testing.T) {
		t.Parallel()
		listed, err := session.ListSchemas(t.Context(), api.ListSchemasParams{ProjectID: customerProjectID})
		require.NoError(t, err)
		schemas, ok := listed.(*api.ListSchemasResponse)
		require.True(t, ok, helpers.MustMarshal(t, listed))
		require.NotEmpty(t, schemas.Schemas)

		// Schema ids are unique per project only (the seeded default carries
		// the same $id everywhere), so the session names the project.
		resp, err := session.GetSchemaById(t.Context(), api.GetSchemaByIdParams{
			ID:        schemas.Schemas[0].ID,
			ProjectID: api.NewOptProjectID(customerProjectID),
		})
		require.NoError(t, err)
		got, ok := resp.(*api.Schema)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		require.Equal(t, schemas.Schemas[0].ID, got.ID)
	})

	t.Run("flow definition", func(t *testing.T) {
		t.Parallel()
		listed, err := session.ListFlowDefinitions(t.Context(), api.ListFlowDefinitionsParams{ProjectID: customerProjectID})
		require.NoError(t, err)
		flows, ok := listed.(*api.FlowDefinitionListResponse)
		require.True(t, ok, helpers.MustMarshal(t, listed))
		require.NotEmpty(t, flows.FlowDefinitions)

		resp, err := session.GetFlowDefinition(t.Context(), api.GetFlowDefinitionParams{ID: flows.FlowDefinitions[0].ID})
		require.NoError(t, err)
		require.IsType(t, &api.FlowDefinitionResponse{}, resp, helpers.MustMarshal(t, resp))
	})

	t.Run("branding", func(t *testing.T) {
		t.Parallel()
		created, err := customerSecret.CreateBranding(t.Context(), &api.Branding{
			Layout: api.NewOptBrandingLayout(api.BrandingLayoutSplit),
		}, api.CreateBrandingParams{ProjectID: customerProjectID})
		require.NoError(t, err)
		revision, ok := created.(*api.BrandingRevisionResponse)
		require.True(t, ok, helpers.MustMarshal(t, created))

		resp, err := session.GetBrandingById(t.Context(), api.GetBrandingByIdParams{ID: revision.ID})
		require.NoError(t, err)
		require.IsType(t, &api.BrandingRevisionResponse{}, resp, helpers.MustMarshal(t, resp))
	})

	// The Authentication screen lists the connections and opens one by id;
	// both name the project, so the grant on it is what admits the session.
	t.Run("identity provider", func(t *testing.T) {
		t.Parallel()
		created := idpFixture{project: customer, client: customerSecret}.create(t, helpers.OIDCConnection("google"))

		read := idpFixture{project: customer, client: session}
		require.Contains(t, idpIDs(read.queryOK(t, &api.QueryIdpsRequest{}).Idps), created.ID)
		got := read.get(t, created.ID)
		require.IsType(t, &api.IdpResponse{}, got, helpers.MustMarshal(t, got))
		revision, err := session.GetIdpRevisionById(t.Context(), api.GetIdpRevisionByIdParams{ProjectID: api.ProjectID(customer.ID), RevisionID: created.RevisionID})
		require.NoError(t, err)
		require.IsType(t, &api.IdpResponse{}, revision, helpers.MustMarshal(t, revision))
	})

	t.Run("release", func(t *testing.T) {
		t.Parallel()
		created := seedRelease(t, customerSecret, customer.ID)

		listed, err := session.ListReleases(t.Context(), api.ListReleasesParams{ProjectID: customerProjectID})
		require.NoError(t, err)
		require.IsType(t, &api.ListReleasesResponse{}, listed, helpers.MustMarshal(t, listed))
		require.Contains(t, releaseIDs(listed.(*api.ListReleasesResponse).Releases), created.ID)
		got, err := session.GetReleaseById(t.Context(), api.GetReleaseByIdParams{ProjectID: customerProjectID, ReleaseID: created.ID})
		require.NoError(t, err)
		require.IsType(t, &api.Release{}, got, helpers.MustMarshal(t, got))
	})

	t.Run("origins and variables", func(t *testing.T) {
		t.Parallel()
		origin := api.ProjectOrigin{Pattern: "https://granted-origin.example.com", Kind: api.ProjectOriginKindPreview}
		added, err := session.AddOrigin(t.Context(), &origin, api.AddOriginParams{ProjectID: customerProjectID})
		require.NoError(t, err)
		require.IsType(t, &api.AddOriginResponse{}, added, helpers.MustMarshal(t, added))
		removed, err := session.RemoveOrigin(t.Context(), &api.RemoveOriginReq{Pattern: origin.Pattern}, api.RemoveOriginParams{ProjectID: customerProjectID})
		require.NoError(t, err)
		require.IsType(t, &api.RemoveOriginNoContent{}, removed, helpers.MustMarshal(t, removed))

		written, err := customerSecret.UpdateVariables(t.Context(), api.UpdateVariablesRequest{
			"GRANTED_READ": api.NewVariableScalarVariableInput(api.NewStringVariableScalar("granted")),
		}, api.UpdateVariablesParams{ProjectID: customerProjectID})
		require.NoError(t, err)
		require.IsType(t, &api.VariablesByKind{}, written, helpers.MustMarshal(t, written))
		listed, err := session.GetVariables(t.Context(), api.GetVariablesParams{ProjectID: customerProjectID})
		require.NoError(t, err)
		require.IsType(t, &api.VariablesByKind{}, listed, helpers.MustMarshal(t, listed))
		require.Contains(t, *listed.(*api.VariablesByKind), "GRANTED_READ")
		one, err := session.GetVariable(t.Context(), api.GetVariableParams{ProjectID: customerProjectID, VariableName: "GRANTED_READ"})
		require.NoError(t, err)
		require.IsType(t, &api.VariableByKind{}, one, helpers.MustMarshal(t, one))
	})

	t.Run("without a grant the resource is not found", func(t *testing.T) {
		t.Parallel()
		strangerID, _ := harness.CreateUserOwnedByTeam(t, console.ID)
		stranger := sessionClientForUser(t, strangerID)

		user, err := stranger.GetUserByID(t.Context(), api.GetUserByIDParams{UserID: api.UserID(customerUserID)})
		require.NoError(t, err)
		require.IsType(t, &api.GetUserByIDNotFound{}, user, helpers.MustMarshal(t, user))

		team, err := stranger.GetTeam(t.Context(), api.GetTeamParams{TeamID: api.TeamID(customerTeamID)})
		require.NoError(t, err)
		require.IsType(t, &api.GetTeamNotFound{}, team, helpers.MustMarshal(t, team))
	})

	// The cross-project lookup is for user principals only: a project secret
	// still resolves ids in its own project, so another project's user is the
	// same not-found as before.
	t.Run("a project secret stays bound to its own project", func(t *testing.T) {
		t.Parallel()
		secret, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		harness.SetProjectSecretOnApiClient(t, secret, console)

		resp, err := secret.GetUserByID(t.Context(), api.GetUserByIDParams{UserID: api.UserID(customerUserID)})
		require.NoError(t, err)
		require.IsType(t, &api.GetUserByIDNotFound{}, resp, helpers.MustMarshal(t, resp))
	})
}

// TestConsoleSessionExpandsUserTeams pins #1300 §4: a session mints no
// scopes, so queryUsers' team_membership.read / team.read expansions ask the
// resolver for read authority on the target project instead. The Console's
// Team column depends on it.
func TestConsoleSessionExpandsUserTeams(t *testing.T) {
	t.Parallel()

	console := harness.EnsurePlatformProject(t)
	operatorID, _ := harness.CreateUserOwnedByTeam(t, console.ID)

	customer, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	harness.SeedProjectAdmin(t, customer.ID, operatorID)
	// Owned by the team as well as a member of it, so both expansions have
	// something to resolve.
	memberID, memberTeamID := harness.CreateUserOwnedByTeam(t, customer.ID)

	session := sessionClientForUser(t, operatorID)
	resp, err := session.QueryUsers(t.Context(), &api.QueryUsersRequest{
		Expand: []api.UserExpand{api.UserExpandTeams, api.UserExpandLifecycleOwnerTeam},
	}, api.QueryUsersParams{ProjectID: api.NewOptProjectID(api.ProjectID(customer.ID))})
	require.NoError(t, err)
	listed, ok := resp.(*api.QueryUsersResponse)
	require.True(t, ok, helpers.MustMarshal(t, resp))

	idx := slices.IndexFunc(listed.Users, func(u api.User) bool { return userID(t, u) == memberID })
	require.GreaterOrEqual(t, idx, 0, helpers.MustMarshal(t, listed))
	member := listed.Users[idx]

	require.True(t, slices.ContainsFunc(member.Teams, func(team api.UserTeam) bool { return team.ID == memberTeamID }),
		"expand teams must embed the member's team: %s", helpers.MustMarshal(t, member))
	owner, ok := member.Metadata.LifecycleOwnerTeam.Get()
	require.True(t, ok, "expand lifecycle_owner_team must embed the owner: %s", helpers.MustMarshal(t, member))
	assert.Equal(t, memberTeamID, owner.ID)
}

// TestConsoleSessionPartialAccessDoesNotExpand pins #1300 §4 hardened: the
// expand permissions come from the resolver (viewer on the target project),
// not from passing the list check. A viewer grant scoped to one team is a
// foothold, so the list answers with the users that team's scope reaches, but
// it is not project-wide read authority, so expanding memberships or the
// owner team is refused.
func TestConsoleSessionPartialAccessDoesNotExpand(t *testing.T) {
	t.Parallel()

	_, operatorID, cookie := ownSessionUser(t)

	customer, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	memberID, teamID := harness.CreateUserOwnedByTeam(t, customer.ID)
	asgn := &domain.AuthzAssignment{
		ProjectID:     customer.ID,
		CatalogID:     domain.SystemCatalogID,
		PrincipalType: domain.AuthzPrincipalTypeUser,
		PrincipalID:   operatorID,
		ObjectType:    "project",
		Relation:      "viewer",
	}
	asgn.ApplyScope(domain.NewTeamAssignmentScope(teamID))
	require.NoError(t, harness.EnsureServiceDB(t).Statements().CreateAuthzAssignment(t.Context(), asgn))

	session, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	session.SetSessionToken(cookie.Value)
	params := api.QueryUsersParams{ProjectID: api.NewOptProjectID(api.ProjectID(customer.ID))}

	listed, err := session.QueryUsers(t.Context(), &api.QueryUsersRequest{}, params)
	require.NoError(t, err)
	require.IsType(t, &api.QueryUsersResponse{}, listed, "the foothold still lists: %s", helpers.MustMarshal(t, listed))

	byTeam := &api.QueryUsersRequest{}
	require.NoError(t, byTeam.UnmarshalJSON([]byte(`{"filter":[{"field":"team_id","operation":"equals","value":"`+teamID+`"}]}`)))
	for name, req := range map[string]*api.QueryUsersRequest{
		"expand teams":                {Expand: []api.UserExpand{api.UserExpandTeams}},
		"expand lifecycle owner team": {Expand: []api.UserExpand{api.UserExpandLifecycleOwnerTeam}},
		// The filter reads the same memberships by another route, so it takes
		// the same gate.
		"team_id filter": byTeam,
	} {
		t.Run(name, func(t *testing.T) {
			resp, err := session.QueryUsers(t.Context(), req, params)
			require.NoError(t, err)
			require.IsType(t, &api.QueryUsersForbidden{}, resp, helpers.MustMarshal(t, resp))
			assert.Equal(t, api.ErrorCode("user.permission_denied"), resp.(*api.QueryUsersForbidden).Code)
		})
	}
	// A user's RSI row names no team, so the user is outside a team-scoped
	// grant and its roster answers not found before any membership gate
	// (#2112); TestConsoleSessionByIDTeamFilterNeedsProjectRead pins the gate.
	t.Run("list user teams", func(t *testing.T) {
		resp, err := session.ListUserTeams(t.Context(), api.ListUserTeamsParams{UserID: api.UserID(memberID)})
		require.NoError(t, err)
		require.IsType(t, &api.ListUserTeamsNotFound{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode("user.not_found"), resp.(*api.ListUserTeamsNotFound).Code)
	})
}

// TestConsoleSessionSchemaInUseNeedsProjectRead pins the gate on
// GET /schemas?expand=in_use: the flag says whether users exist on a revision,
// so it is read under the users' permission (ADR 059 rule 8). A session minting
// no scopes gets it from read on the whole project; a viewer grant scoped to
// one team still lists schemas but is refused the flag.
func TestConsoleSessionSchemaInUseNeedsProjectRead(t *testing.T) {
	t.Parallel()

	customer, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	_, teamID := harness.CreateUserOwnedByTeam(t, customer.ID)
	params := api.ListSchemasParams{
		ProjectID: api.ProjectID(customer.ID),
		Expand:    []api.SchemaExpand{api.SchemaExpandInUse},
	}

	t.Run("read on the whole project", func(t *testing.T) {
		t.Parallel()
		console := harness.EnsurePlatformProject(t)
		operatorID, _ := harness.CreateUserOwnedByTeam(t, console.ID)
		harness.SeedProjectAdmin(t, customer.ID, operatorID)

		resp, err := sessionClientForUser(t, operatorID).ListSchemas(t.Context(), params)
		require.NoError(t, err)
		listed, ok := resp.(*api.ListSchemasResponse)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		require.NotEmpty(t, listed.Schemas)
		for _, schema := range listed.Schemas {
			assert.True(t, schema.Metadata.InUse.Set, "in_use must be set on %s", schema.ID)
		}
	})

	t.Run("a grant scoped to one team", func(t *testing.T) {
		t.Parallel()
		_, operatorID, cookie := ownSessionUser(t)
		asgn := &domain.AuthzAssignment{
			ProjectID:     customer.ID,
			CatalogID:     domain.SystemCatalogID,
			PrincipalType: domain.AuthzPrincipalTypeUser,
			PrincipalID:   operatorID,
			ObjectType:    "project",
			Relation:      "viewer",
		}
		asgn.ApplyScope(domain.NewTeamAssignmentScope(teamID))
		require.NoError(t, harness.EnsureServiceDB(t).Statements().CreateAuthzAssignment(t.Context(), asgn))
		session, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		session.SetSessionToken(cookie.Value)

		listed, err := session.ListSchemas(t.Context(), api.ListSchemasParams{ProjectID: params.ProjectID})
		require.NoError(t, err)
		require.IsType(t, &api.ListSchemasResponse{}, listed, "the foothold still lists: %s", helpers.MustMarshal(t, listed))

		resp, err := session.ListSchemas(t.Context(), params)
		require.NoError(t, err)
		status, code, _, ok := errorResponseParts(t, resp)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		assert.Equal(t, http.StatusForbidden, status)
		assert.Equal(t, domain.ErrJSONSchemaPermissionDenied().Code, code)
	})
}

// TestConsoleSessionByIDTeamFilterNeedsProjectRead closes the side door next
// to TestConsoleSessionPartialAccessDoesNotExpand: GET /users/{id}?team_id=
// answers "is this user an active member of that team", the membership read
// POST /users/query gates behind project-wide read for a session. A viewer
// grant on just this user reads the user, but not their memberships.
func TestConsoleSessionByIDTeamFilterNeedsProjectRead(t *testing.T) {
	t.Parallel()

	_, operatorID, cookie := ownSessionUser(t)
	customer, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	memberID, teamID := harness.CreateUserOwnedByTeam(t, customer.ID)
	asgn := &domain.AuthzAssignment{
		ProjectID:     customer.ID,
		CatalogID:     domain.SystemCatalogID,
		PrincipalType: domain.AuthzPrincipalTypeUser,
		PrincipalID:   operatorID,
		ObjectType:    "project",
		Relation:      "viewer",
	}
	asgn.ApplyScope(domain.NewResourceAssignmentScope(memberID))
	require.NoError(t, harness.EnsureServiceDB(t).Statements().CreateAuthzAssignment(t.Context(), asgn))

	session, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	session.SetSessionToken(cookie.Value)

	read, err := session.GetUserByID(t.Context(), api.GetUserByIDParams{UserID: api.UserID(memberID)})
	require.NoError(t, err)
	require.IsType(t, &api.User{}, read, "the grant reads the user: %s", helpers.MustMarshal(t, read))

	byTeam, err := session.GetUserByID(t.Context(), api.GetUserByIDParams{
		UserID: api.UserID(memberID),
		TeamID: api.NewOptTeamID(api.TeamID(teamID)),
	})
	require.NoError(t, err)
	require.IsType(t, &api.GetUserByIDErrorResponseStatusCode{}, byTeam, helpers.MustMarshal(t, byTeam))
	refused := byTeam.(*api.GetUserByIDErrorResponseStatusCode)
	assert.Equal(t, http.StatusForbidden, refused.StatusCode)
	assert.True(t, refused.Response.IsUserPermissionDenied(), helpers.MustMarshal(t, byTeam))

	// The roster reads the same memberships by its own route.
	roster, err := session.ListUserTeams(t.Context(), api.ListUserTeamsParams{UserID: api.UserID(memberID)})
	require.NoError(t, err)
	require.IsType(t, &api.ListUserTeamsForbidden{}, roster, helpers.MustMarshal(t, roster))
	assert.Equal(t, api.ErrorCode("user.permission_denied"), roster.(*api.ListUserTeamsForbidden).Code)
}

// TestConsoleSessionProjectViewerReadsMemberships is the allowed side of the
// two refusals above: read on the whole project, the plain viewer grant and the
// least the rule asks for, is enough for every membership read a session can
// make. TestConsoleSessionExpandsUserTeams shows the same with an admin grant.
func TestConsoleSessionProjectViewerReadsMemberships(t *testing.T) {
	t.Parallel()

	_, operatorID, cookie := ownSessionUser(t)
	customer, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	memberID, teamID := harness.CreateUserOwnedByTeam(t, customer.ID)
	_, otherTeamID := harness.CreateUserOwnedByTeam(t, customer.ID)
	harness.SeedProjectViewer(t, customer.ID, operatorID)

	session, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	session.SetSessionToken(cookie.Value)
	params := api.QueryUsersParams{ProjectID: api.NewOptProjectID(api.ProjectID(customer.ID))}

	t.Run("expansions", func(t *testing.T) {
		resp, err := session.QueryUsers(t.Context(), &api.QueryUsersRequest{
			Expand: []api.UserExpand{api.UserExpandTeams, api.UserExpandLifecycleOwnerTeam},
		}, params)
		require.NoError(t, err)
		listed, ok := resp.(*api.QueryUsersResponse)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		idx := slices.IndexFunc(listed.Users, func(u api.User) bool { return userID(t, u) == memberID })
		require.GreaterOrEqual(t, idx, 0, helpers.MustMarshal(t, listed))
		member := listed.Users[idx]
		assert.True(t, slices.ContainsFunc(member.Teams, func(team api.UserTeam) bool { return team.ID == teamID }),
			"expand teams must embed the member's team: %s", helpers.MustMarshal(t, member))
		owner, ok := member.Metadata.LifecycleOwnerTeam.Get()
		require.True(t, ok, "expand lifecycle_owner_team must embed the owner: %s", helpers.MustMarshal(t, member))
		assert.Equal(t, teamID, owner.ID)
	})

	t.Run("team_id filter", func(t *testing.T) {
		byTeam := &api.QueryUsersRequest{}
		require.NoError(t, byTeam.UnmarshalJSON([]byte(`{"filter":[{"field":"team_id","operation":"equals","value":"`+teamID+`"}]}`)))
		resp, err := session.QueryUsers(t.Context(), byTeam, params)
		require.NoError(t, err)
		listed, ok := resp.(*api.QueryUsersResponse)
		require.True(t, ok, helpers.MustMarshal(t, resp))
		ids := make([]string, 0, len(listed.Users))
		for _, u := range listed.Users {
			ids = append(ids, userID(t, u))
		}
		assert.Equal(t, []string{memberID}, ids)
	})

	t.Run("by id with team_id", func(t *testing.T) {
		read, err := session.GetUserByID(t.Context(), api.GetUserByIDParams{
			UserID: api.UserID(memberID),
			TeamID: api.NewOptTeamID(api.TeamID(teamID)),
		})
		require.NoError(t, err)
		user, ok := read.(*api.User)
		require.True(t, ok, helpers.MustMarshal(t, read))
		assert.Equal(t, memberID, userID(t, *user))

		// Past the gate, the parameter answers the membership question: not a
		// member of that team is 404, not 403.
		miss, err := session.GetUserByID(t.Context(), api.GetUserByIDParams{
			UserID: api.UserID(memberID),
			TeamID: api.NewOptTeamID(api.TeamID(otherTeamID)),
		})
		require.NoError(t, err)
		require.IsType(t, &api.GetUserByIDNotFound{}, miss, helpers.MustMarshal(t, miss))
	})
}

// TestConsoleManagementBearerIgnoresStaleCookie pins the dual-scheme
// precedence: a valid project secret authorizes the request even when a stale
// or malformed session cookie rides along, instead of the cookie's failure
// turning it into a 401.
func TestConsoleManagementBearerIgnoresStaleCookie(t *testing.T) {
	t.Parallel()

	console := harness.EnsurePlatformProject(t)
	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost,
		harness.EnsureTestServer(t).URL+"/teams?project_id="+console.ID,
		strings.NewReader(`{"name":"`+helpers.TeamName()+`"}`))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+harness.ProjectSecret(t, console))
	req.AddCookie(&http.Cookie{Name: "__nextgen_session", Value: "stale-or-garbage"})

	resp, err := harness.EnsureHttpClient(t).Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	assert.Equal(t, http.StatusCreated, resp.StatusCode)
}

// TestConsoleSessionRevokedStopsAuthorizing pins session liveness (ADR 053
// §5): a signed-out session's cookie still decrypts, but it must stop
// authorizing management calls at once rather than when the cookie expires.
// No extra session lookup provides this: revoking a session deletes its token
// records in the same transaction, and IntrospectToken rejects a cookie whose
// record is gone. The 401 is what sends the Console back to its login screen.
func TestConsoleSessionRevokedStopsAuthorizing(t *testing.T) {
	t.Parallel()

	home, operatorID, cookie := ownSessionUser(t)
	harness.SeedProjectAdmin(t, home.ID, operatorID)

	session, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	session.SetSessionToken(cookie.Value)

	queryUsers := func() int {
		t.Helper()
		req, err := http.NewRequestWithContext(t.Context(), http.MethodPost,
			harness.EnsureTestServer(t).URL+"/users/query?project_id="+home.ID, strings.NewReader(`{}`))
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(cookie)
		resp, err := harness.EnsureHttpClient(t).Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()
		return resp.StatusCode
	}

	require.Equal(t, http.StatusOK, queryUsers(), "the live session authorizes")

	revoked, err := session.RevokeMySession(t.Context(), api.RevokeMySessionParams{})
	require.NoError(t, err)
	require.IsType(t, &api.RevokeMySessionNoContent{}, revoked, helpers.MustMarshal(t, revoked))

	assert.Equal(t, http.StatusUnauthorized, queryUsers(), "the revoked session's cookie must not authorize")
}

// requireUsersNotFound pins a refused users list to its not-found shape: 404
// user.not_found, the same answer as a project that does not exist.
func requireUsersNotFound(t *testing.T, resp api.QueryUsersRes) {
	t.Helper()
	require.IsType(t, &api.QueryUsersErrorResponseStatusCode{}, resp, helpers.MustMarshal(t, resp))
	denied := resp.(*api.QueryUsersErrorResponseStatusCode)
	assert.Equal(t, http.StatusNotFound, denied.StatusCode)
	assert.True(t, denied.Response.IsUserNotFound(), helpers.MustMarshal(t, resp))
}

// TestConsoleSessionReadsUserTeams: GET /users/{id}/teams takes the session
// the way the membership expansion does (#1300 §4): viewer on the user's
// project reads the roster, no grant does not find the user. The team-scoped
// foothold is in TestConsoleSessionPartialAccessDoesNotExpand.
func TestConsoleSessionReadsUserTeams(t *testing.T) {
	t.Parallel()

	_, operatorID, cookie := ownSessionUser(t)
	session, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	session.SetSessionToken(cookie.Value)

	t.Run("viewer on the project reads the roster", func(t *testing.T) {
		t.Parallel()
		customer, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
		require.NoError(t, err)
		memberID := harness.CreateUserWithTeam(t, customer.ID)
		harness.SeedProjectViewer(t, customer.ID, operatorID)

		resp, err := session.ListUserTeams(t.Context(), api.ListUserTeamsParams{UserID: api.UserID(memberID)})
		require.NoError(t, err)
		require.IsType(t, &api.ListUserTeamsResponse{}, resp, helpers.MustMarshal(t, resp))
		assert.Len(t, resp.(*api.ListUserTeamsResponse).Teams, 1)
	})

	t.Run("no grant does not find the user", func(t *testing.T) {
		t.Parallel()
		customer, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
		require.NoError(t, err)
		memberID := harness.CreateUserWithTeam(t, customer.ID)

		resp, err := session.ListUserTeams(t.Context(), api.ListUserTeamsParams{UserID: api.UserID(memberID)})
		require.NoError(t, err)
		require.IsType(t, &api.ListUserTeamsNotFound{}, resp, helpers.MustMarshal(t, resp))
		assert.Equal(t, api.ErrorCode("user.not_found"), resp.(*api.ListUserTeamsNotFound).Code)
	})
}

// TestPersonalTeamOwnerRenamesTheirTeam: the team a platform user is given at
// sign-up is theirs to rename (the owner grant EnsurePersonalTeam writes), and
// the grant reaches no other team. Run against a project of the test's own,
// configured as the platform project for the ensure.
func TestPersonalTeamOwnerRenamesTheirTeam(t *testing.T) {
	t.Parallel()

	platform, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	ensurer := service.NewPersonalTeamService(harness.EnsureServiceDB(t), platform.ID)
	signUp := func(t *testing.T) (*http.Cookie, string) {
		t.Helper()
		user, err := harness.EnsureUserService(t).CreateUser(t.Context(), service.CreateUserInput{
			ProjectID:  platform.ID,
			SchemaURL:  test_data.UserSchemaURL,
			Attributes: harness.EnsureTestData(t).Generator.GenerateUser(t, helpers.ProjectName()+"@example.com"),
		})
		require.NoError(t, err)
		require.NoError(t, ensurer.EnsurePersonalTeam(t.Context(), platform.ID, user.ID))
		cookie := sessionCookieIn(t, platform, user.ID)
		status, body := consoleCall(t, cookie, http.MethodGet, "/users/me/teams", "")
		require.Equal(t, http.StatusOK, status, body)
		teams := helpers.MustUnmarshal[api.ListUserTeamsResponse](t, []byte(body)).Teams
		require.Len(t, teams, 1)
		return cookie, string(teams[0].ID)
	}
	cookie, teamID := signUp(t)
	otherUserID := harness.CreateUserWithTeam(t, platform.ID)
	_, otherTeamID := signUp(t)

	t.Run("renames their team", func(t *testing.T) {
		status, body := consoleCall(t, cookie, http.MethodPatch, "/teams/"+teamID, `{"name":"Acme Platform"}`)
		require.Equal(t, http.StatusOK, status, body)
		assert.Equal(t, "Acme Platform", helpers.MustUnmarshal[api.TeamResponse](t, []byte(body)).Name)
	})

	// The grant reaches nothing else in the platform project. Another
	// customer's team or user answers like an id that names nothing (#2112);
	// the platform project itself is no secret and keeps its 403.
	for name, tc := range map[string]struct {
		method, path, body string
		status             int
		code               string
	}{
		"cannot rename another user's team": {http.MethodPatch, "/teams/" + otherTeamID, `{"name":"Not mine"}`, http.StatusNotFound, "team.team_not_found"},
		"cannot read another platform user": {http.MethodGet, "/users/" + otherUserID, "", http.StatusNotFound, "user.not_found"},
		"cannot read the platform project":  {http.MethodGet, "/projects/" + platform.ID, "", http.StatusForbidden, "proj.permission_denied"},
	} {
		t.Run(name, func(t *testing.T) {
			status, body := consoleCall(t, cookie, tc.method, tc.path, tc.body)
			assert.Equal(t, tc.status, status, body)
			assert.Equal(t, api.ErrorCode(tc.code), helpers.MustUnmarshal[api.ErrorDetails](t, []byte(body)).Code)
		})
	}
}

// seedRelease builds a release pinning the project's seeded flow definition
// and the user schema it names (a release must resolve its own references),
// through the project secret: that is the only principal the build accepts.
func seedRelease(t *testing.T, secret *helpers.ApiClient, projectID string) api.Release {
	t.Helper()
	flows, err := secret.ListFlowDefinitions(t.Context(), api.ListFlowDefinitionsParams{ProjectID: api.ProjectID(projectID)})
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionListResponse{}, flows, helpers.MustMarshal(t, flows))
	definitions := flows.(*api.FlowDefinitionListResponse).FlowDefinitions
	require.NotEmpty(t, definitions)
	schemas, err := secret.ListSchemas(t.Context(), api.ListSchemasParams{ProjectID: api.ProjectID(projectID)})
	require.NoError(t, err)
	require.IsType(t, &api.ListSchemasResponse{}, schemas, helpers.MustMarshal(t, schemas))
	pointers := []api.CreateReleasePointer{{Kind: api.ReleasePointerKindFlowDefinition, RevisionID: definitions[0].ID}}
	for _, schema := range schemas.(*api.ListSchemasResponse).Schemas {
		pointers = append(pointers, api.CreateReleasePointer{Kind: api.ReleasePointerKindSchema, RevisionID: schema.ID})
	}

	resp, err := secret.CreateRelease(t.Context(), &api.CreateReleaseRequest{
		Pointers: pointers,
	}, api.CreateReleaseParams{ProjectID: api.ProjectID(projectID)})
	require.NoError(t, err)
	require.IsType(t, &api.CreateReleaseCreated{}, resp, helpers.MustMarshal(t, resp))
	return api.Release(*resp.(*api.CreateReleaseCreated))
}

func releaseIDs(releases []api.ReleaseSummary) []api.ReleaseID {
	ids := make([]api.ReleaseID, 0, len(releases))
	for _, release := range releases {
		ids = append(ids, release.ID)
	}
	return ids
}
