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

// A caller granted one user finds that user and no other, whichever property
// the text matches, and learns nothing about the users it cannot see: not
// their number, and not that an id or an email exists.
//
// A grant on one team reaches no user (TestListAuthzTeamScopedOnlyPartialView:
// users register without a team), and no service path mints a grant on one
// user yet, so it is written straight to storage, as
// TestAuthzListPredicate_UsersBySearch does. It is the one partial view of
// users there is, and the search has to hold under it before a product path
// makes it reachable.
//
// Serial for the reason TestSearchTeamScopedPartialView gives.
func TestSearchPartialViewOfUsers(t *testing.T) {
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = harness.EnsureServiceDB(t).Statements().DeleteProjectByID(context.Background(), project.ID)
	})

	schemaURL := harness.CreateUserSchema(t, project, `{
		"title": "ScopedNamedUser",
		"metaSchema": "https://test.example.schemas.com/schemas/user-schema.json",
		"$id": "https://search.example.com/schemas/scoped-named-user.json",
		"kind": "user-schema",
		"objectType": "scoped-named-user",
		"type": "object",
		"x-identifier": "email",
		"x-display": ["givenName", "familyName"],
		"x-auth-methods": {"password": {"enabled": true}},
		"properties": {
			"email": {"type": "string", "format": "email", "x-unique": "project"},
			"givenName": {"type": "string"},
			"familyName": {"type": "string"}
		}
	}`)
	seed := func(t *testing.T, email, givenName, familyName string) string {
		t.Helper()
		user, err := harness.EnsureUserService(t).CreateUser(t.Context(), service.CreateUserInput{
			ProjectID:  project.ID,
			SchemaURL:  schemaURL,
			Attributes: map[string]any{"email": email, "givenName": givenName, "familyName": familyName},
		})
		require.NoError(t, err)
		return user.ID
	}
	// Every hidden user sorts before the visible one on each property, so a
	// read that applied the grant after its limit would come back empty or
	// report more.
	visible := seed(t, "scoped-zed@search.example.com", "Zelda", "Quince")
	hidden := seed(t, "scoped-amy@search.example.com", "Zelda", "Quince")
	seed(t, "scoped-bea@search.example.com", "Zela", "Quinn")
	seed(t, "scoped-cat@search.example.com", "Zelma", "Quint")

	stmts := harness.EnsureServiceDB(t).Statements()
	assignments, err := stmts.ListAuthzAssignments(t.Context(), project.ID, domain.AuthzPrincipalTypeSKProj, project.ID, false)
	require.NoError(t, err)
	require.NotEmpty(t, assignments, "CreateProject seeds sk_proj → project.admin")

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)
	users := []api.SearchResultType{api.SearchResultTypeUser}
	search := func(t *testing.T, query string, limit int) *api.SearchResponse {
		t.Helper()
		req := &api.SearchRequest{Query: query, Types: users}
		if limit > 0 {
			req.LimitPerType = api.NewOptInt(limit)
		}
		return searchResults(t, client, req, api.SearchParams{})
	}

	// The project-wide secret sees all four, which is what makes the narrowed
	// answers below mean something.
	require.Len(t, search(t, "scoped-", 20).Results, 4)
	require.Len(t, search(t, "zel", 20).Results, 4)

	for _, assignment := range assignments {
		require.NoError(t, stmts.RevokeAuthzAssignment(t.Context(), project.ID, assignment.ID))
	}
	scoped := &domain.AuthzAssignment{
		ProjectID:     project.ID,
		CatalogID:     domain.SystemCatalogID,
		PrincipalType: domain.AuthzPrincipalTypeSKProj,
		PrincipalID:   project.ID,
		ObjectType:    "project",
		Relation:      "viewer",
	}
	scoped.ApplyScope(domain.NewResourceAssignmentScope(visible))
	require.NoError(t, stmts.CreateAuthzAssignment(t.Context(), scoped))

	for name, query := range map[string]string{
		"the start of the identifier":  "scoped-",
		"the start of the given name":  "zel",
		"the start of the family name": "qui",
		"a whole given name":           "zelda",
	} {
		t.Run(name, func(t *testing.T) {
			got := search(t, query, 20)
			assert.Equal(t, []string{visible}, searchResultIDs(got.Results))
			assert.Empty(t, got.IncompleteTypes)
		})
	}

	t.Run("hidden matches do not count towards the limit or report more", func(t *testing.T) {
		got := search(t, "scoped-", 1)
		assert.Equal(t, []string{visible}, searchResultIDs(got.Results))
		assert.Empty(t, got.IncompleteTypes)
	})

	t.Run("the result names the user as their own list does", func(t *testing.T) {
		got := search(t, "zel", 20)
		require.Len(t, got.Results, 1)
		assert.Equal(t, "Zelda Quince", got.Results[0].Title)
		assert.Equal(t, "scoped-zed@search.example.com", got.Results[0].Subtitle.Or(""))
	})

	t.Run("a whole identifier outside the grant finds nobody", func(t *testing.T) {
		got := search(t, "scoped-amy@search.example.com", 20)
		assert.Empty(t, got.Results)
		assert.Empty(t, got.IncompleteTypes)
	})

	t.Run("an id finds a user inside the grant only", func(t *testing.T) {
		assert.Equal(t, []string{visible}, searchResultIDs(search(t, visible, 20).Results))
		got := search(t, hidden, 20)
		assert.Empty(t, got.Results)
		assert.Empty(t, got.IncompleteTypes)
	})

	t.Run("the users list agrees", func(t *testing.T) {
		resp, err := client.QueryUsers(t.Context(), &api.QueryUsersRequest{}, api.QueryUsersParams{
			ProjectID: api.NewOptProjectID(api.ProjectID(project.ID)),
		})
		require.NoError(t, err)
		require.IsType(t, &api.QueryUsersResponse{}, resp, helpers.MustMarshal(t, resp))
		listed := resp.(*api.QueryUsersResponse).Users
		require.Len(t, listed, 1)
		assert.Equal(t, visible, string(listed[0].ID))
	})
}

// The preview secret is the browser's credential: it carries project.read and
// reaches no management read, search included, whichever type it asks for.
func TestSearchRefusesThePreviewSecret(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = harness.EnsureServiceDB(t).Statements().DeleteProjectByID(context.Background(), project.ID)
	})
	seedSearchUser(t, project.ID, "", map[string]any{"email": "preview@search.example.com"})

	preview, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetPreviewSecretOnApiClient(t, preview, project)

	for _, resultType := range api.SearchResultTypeUser.AllValues() {
		t.Run(string(resultType), func(t *testing.T) {
			t.Parallel()
			resp, err := preview.Search(t.Context(), &api.SearchRequest{
				Query: "preview",
				Types: []api.SearchResultType{resultType},
			}, api.SearchParams{})
			require.NoError(t, err)
			require.IsType(t, &api.SearchForbidden{}, resp, helpers.MustMarshal(t, resp))
			assertAuthzError(t, resp, domain.ErrProjectPermissionDenied().Code)
		})
	}
}
