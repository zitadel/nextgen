//go:build postgres_integration || spanner_integration || sqlite_integration

package integration_test

import (
	"context"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	apischemas "github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	api "go.zitadel.com/zitadel/v5/api"
)

// searchResults is the search answer for a request that must succeed.
func searchResults(t *testing.T, client *helpers.ApiClient, req *api.SearchRequest, params api.SearchParams) *api.SearchResponse {
	t.Helper()
	resp, err := client.Search(t.Context(), req, params)
	require.NoError(t, err)
	require.IsType(t, &api.SearchResponse{}, resp, helpers.MustMarshal(t, resp))
	return resp.(*api.SearchResponse)
}

func searchResultIDs(results []api.SearchResult) []string {
	ids := make([]string, 0, len(results))
	for _, result := range results {
		ids = append(ids, result.ID)
	}
	return ids
}

// seedSearchUser creates a user on schemaURL, or on the builtin human schema
// when it is empty. That schema designates email as the identifier and no
// display.
func seedSearchUser(t *testing.T, projectID, schemaURL string, attributes map[string]any) string {
	t.Helper()
	if schemaURL == "" {
		schemaURL = apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL)
	}
	user, err := harness.EnsureUserService(t).CreateUser(t.Context(), service.CreateUserInput{
		ProjectID:  projectID,
		SchemaURL:  schemaURL,
		Attributes: attributes,
	})
	require.NoError(t, err)
	return user.ID
}

func TestSearch(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	// Teams and users cascade with their project.
	t.Cleanup(func() {
		_, _ = harness.EnsureServiceDB(t).Statements().DeleteProjectByID(context.Background(), project.ID)
	})
	otherProject, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = harness.EnsureServiceDB(t).Statements().DeleteProjectByID(context.Background(), otherProject.ID)
	})

	createTeam := func(t *testing.T, projectID, name string) string {
		t.Helper()
		team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{ProjectID: projectID, Name: name})
		require.NoError(t, err)
		return team.ID
	}
	annex := createTeam(t, project.ID, "Annex")
	paymentsAlpha := createTeam(t, project.ID, "Payments Alpha")
	createTeam(t, project.ID, "payments beta")
	remote := createTeam(t, project.ID, "100% Remote")
	// A team of another project must never surface in this project's results.
	createTeam(t, otherProject.ID, "Rivals Annex")

	// A second schema that also displays its users by name.
	namedSchemaURL := harness.CreateUserSchema(t, project, `{
		"title": "SearchNamedUser",
		"metaSchema": "https://test.example.schemas.com/schemas/user-schema.json",
		"$id": "https://search.example.com/schemas/named-user.json",
		"kind": "user-schema",
		"objectType": "search-named-user",
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
	ann := seedSearchUser(t, project.ID, namedSchemaURL, map[string]any{
		"email": "ann@search.example.com", "givenName": "Ann", "familyName": "Lee",
	})
	joann := seedSearchUser(t, project.ID, "", map[string]any{"email": "joann@search.example.com"})
	bob := seedSearchUser(t, project.ID, "", map[string]any{"email": "bob@search.example.com"})
	seedSearchUser(t, project.ID, "", map[string]any{"email": "bobby@search.example.com"})

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	both := []api.SearchResultType{api.SearchResultTypeUser, api.SearchResultTypeTeam}
	search := func(t *testing.T, req *api.SearchRequest) *api.SearchResponse {
		t.Helper()
		return searchResults(t, client, req, api.SearchParams{})
	}

	t.Run("finds users and teams in one request, best match first", func(t *testing.T) {
		t.Parallel()
		got := search(t, &api.SearchRequest{Query: "ann", Types: both})

		// The user whose given name is the text, then the team it starts.
		// joann@… only contains it: users match from the start of a value.
		require.Equal(t, []string{ann, annex}, searchResultIDs(got.Results))
		assert.Empty(t, got.IncompleteTypes)

		assert.Equal(t, api.SearchResult{
			Type:      api.SearchResultTypeUser,
			ID:        ann,
			ProjectID: api.ProjectID(project.ID),
			Title:     "Ann Lee",
			Subtitle:  api.NewOptString("ann@search.example.com"),
		}, got.Results[0])
		assert.Equal(t, api.SearchResult{
			Type:      api.SearchResultTypeTeam,
			ID:        annex,
			ProjectID: api.ProjectID(project.ID),
			Title:     "Annex",
		}, got.Results[1])
	})

	t.Run("a user without a display is titled by their identifier alone", func(t *testing.T) {
		t.Parallel()
		got := search(t, &api.SearchRequest{Query: "joa", Types: both})
		assert.Equal(t, []api.SearchResult{{
			Type:      api.SearchResultTypeUser,
			ID:        joann,
			ProjectID: api.ProjectID(project.ID),
			Title:     "joann@search.example.com",
		}}, got.Results)
	})

	t.Run("a part of the display name finds its user", func(t *testing.T) {
		t.Parallel()
		got := search(t, &api.SearchRequest{Query: "LEE", Types: both})
		assert.Equal(t, []string{ann}, searchResultIDs(got.Results))
	})

	t.Run("searches only the requested types", func(t *testing.T) {
		t.Parallel()
		got := search(t, &api.SearchRequest{Query: "ann", Types: []api.SearchResultType{api.SearchResultTypeTeam}})
		assert.Equal(t, []string{annex}, searchResultIDs(got.Results))
	})

	t.Run("a whole identifier finds its user alone, whatever its case", func(t *testing.T) {
		t.Parallel()
		got := search(t, &api.SearchRequest{Query: "ANN@search.example.com", Types: both})
		assert.Equal(t, []string{ann}, searchResultIDs(got.Results))
	})

	t.Run("an id finds its resource", func(t *testing.T) {
		t.Parallel()
		got := search(t, &api.SearchRequest{Query: ann, Types: both})
		assert.Equal(t, []string{ann}, searchResultIDs(got.Results))

		got = search(t, &api.SearchRequest{Query: paymentsAlpha, Types: both})
		assert.Equal(t, []string{paymentsAlpha}, searchResultIDs(got.Results))
	})

	t.Run("text too short for users leaves them incomplete", func(t *testing.T) {
		t.Parallel()
		got := search(t, &api.SearchRequest{Query: "an", Types: both})
		assert.Equal(t, []string{annex}, searchResultIDs(got.Results))
		assert.Equal(t, []api.SearchResultType{api.SearchResultTypeUser}, got.IncompleteTypes)
	})

	t.Run("each type contributes at most the limit", func(t *testing.T) {
		t.Parallel()
		got := search(t, &api.SearchRequest{
			Query:        "pay",
			Types:        both,
			LimitPerType: api.NewOptInt(1),
		})
		assert.Equal(t, []string{paymentsAlpha}, searchResultIDs(got.Results))
		assert.Equal(t, []api.SearchResultType{api.SearchResultTypeTeam}, got.IncompleteTypes)

		// Users come from the search index best match first: bob@… before bobby@….
		got = search(t, &api.SearchRequest{
			Query:        "bob",
			Types:        both,
			LimitPerType: api.NewOptInt(1),
		})
		assert.Equal(t, []string{bob}, searchResultIDs(got.Results))
		assert.Equal(t, []api.SearchResultType{api.SearchResultTypeUser}, got.IncompleteTypes)
	})

	t.Run("a later word of a name finds its team", func(t *testing.T) {
		t.Parallel()
		got := search(t, &api.SearchRequest{Query: "ALPH", Types: []api.SearchResultType{api.SearchResultTypeTeam}})
		assert.Equal(t, []string{paymentsAlpha}, searchResultIDs(got.Results))

		// A word starts at a letter or digit, so "%" starts none and "rem" one.
		got = search(t, &api.SearchRequest{Query: "rem", Types: []api.SearchResultType{api.SearchResultTypeTeam}})
		assert.Equal(t, []string{remote}, searchResultIDs(got.Results))
	})

	t.Run("a wildcard character is text", func(t *testing.T) {
		t.Parallel()
		got := search(t, &api.SearchRequest{Query: "100%", Types: []api.SearchResultType{api.SearchResultTypeTeam}})
		assert.Equal(t, []string{remote}, searchResultIDs(got.Results))

		got = search(t, &api.SearchRequest{Query: "%", Types: []api.SearchResultType{api.SearchResultTypeTeam}})
		assert.Empty(t, got.Results)

		got = search(t, &api.SearchRequest{Query: "%@%", Types: []api.SearchResultType{api.SearchResultTypeUser}})
		assert.Empty(t, got.Results)
	})

	t.Run("text of spaces alone finds nothing", func(t *testing.T) {
		t.Parallel()
		got := search(t, &api.SearchRequest{Query: "   ", Types: both})
		assert.Empty(t, got.Results)
		assert.Empty(t, got.IncompleteTypes)
	})

	t.Run("another project's resources stay out", func(t *testing.T) {
		t.Parallel()
		got := search(t, &api.SearchRequest{Query: "Rivals", Types: both})
		assert.Empty(t, got.Results)
	})

	t.Run("a project the credential cannot reach is not found", func(t *testing.T) {
		t.Parallel()
		resp, err := client.Search(t.Context(), &api.SearchRequest{Query: "ann", Types: both},
			api.SearchParams{ProjectID: api.NewOptProjectID(api.ProjectID(otherProject.ID))})
		require.NoError(t, err)
		require.IsType(t, &api.SearchNotFound{}, resp, helpers.MustMarshal(t, resp))
		assertAuthzError(t, resp, domain.ErrProjectNotFound().Code)
	})
}

// A Console session searches with its cookie alone: search is a read, so it
// needs no CSRF token, and the person's grants decide what it finds.
func TestSearchSessionCaller(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = harness.EnsureServiceDB(t).Statements().DeleteProjectByID(context.Background(), project.ID)
	})
	team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{ProjectID: project.ID, Name: "Session Search"})
	require.NoError(t, err)
	subject := seedSearchUser(t, project.ID, "", map[string]any{"email": "search-subject@session.example.com"})

	tokenCrypter, err := harness.EnsureKeyService(t).GetProjectCrypter(t.Context(), project.ID, domain.EncryptionKeyPurposeToken)
	require.NoError(t, err)
	sessionClient := func(t *testing.T, userID string) *helpers.ApiClient {
		t.Helper()
		token, err := harness.CreateActiveSession(t, project.ID, userID).Token(tokenCrypter)
		require.NoError(t, err)
		client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
		require.NoError(t, err)
		client.SetSessionToken(token)
		client.SetOmitCSRF(true)
		return client
	}
	req := &api.SearchRequest{
		Query: "search",
		Types: []api.SearchResultType{api.SearchResultTypeUser, api.SearchResultTypeTeam},
	}

	t.Run("a project viewer finds users and teams", func(t *testing.T) {
		t.Parallel()
		viewer := harness.CreateUserWithTeam(t, project.ID)
		harness.SeedProjectViewer(t, project.ID, viewer)

		got := searchResults(t, sessionClient(t, viewer), req, api.SearchParams{})
		assert.ElementsMatch(t, []string{subject, team.ID}, searchResultIDs(got.Results))
	})

	t.Run("a person without a grant finds nothing", func(t *testing.T) {
		t.Parallel()
		stranger := harness.CreateUserWithTeam(t, project.ID)

		got := searchResults(t, sessionClient(t, stranger), req, api.SearchParams{})
		assert.Empty(t, got.Results)
	})
}

// A grant scoped to one team narrows each type as it narrows that type's own
// list (TestListAuthzTeamScopedOnlyPartialView): that team is found, the
// other is not, and neither is a user or a schema.
//
// Serial for the reason that test gives: the list predicate is slow on the
// Spanner emulator beside everything a parallel run has accumulated.
func TestSearchTeamScopedPartialView(t *testing.T) {
	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = harness.EnsureServiceDB(t).Statements().DeleteProjectByID(context.Background(), project.ID)
	})
	inScope, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{ProjectID: project.ID, Name: "Partial In"})
	require.NoError(t, err)
	outOfScope, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{ProjectID: project.ID, Name: "Partial Out"})
	require.NoError(t, err)
	seedSearchUser(t, project.ID, "", map[string]any{"email": "partial@search.example.com"})
	// Configuration belongs to no team, so a team's grant does not reach it.
	harness.CreateUserSchema(t, project, `{
		"title": "Partial Staff",
		"metaSchema": "https://test.example.schemas.com/schemas/user-schema.json",
		"$id": "https://search.example.com/schemas/partial-staff.json",
		"kind": "user-schema",
		"objectType": "partial-user",
		"type": "object",
		"x-identifier": "email",
		"x-auth-methods": {"password": {"enabled": true}},
		"properties": {
			"email": {"type": "string", "format": "email", "x-unique": "project"}
		}
	}`)

	// Replace the project secret's project-wide role with a viewer grant on
	// one team.
	stmts := harness.EnsureServiceDB(t).Statements()
	assignments, err := stmts.ListAuthzAssignments(t.Context(), project.ID, domain.AuthzPrincipalTypeSKProj, project.ID, false)
	require.NoError(t, err)
	require.NotEmpty(t, assignments, "CreateProject seeds sk_proj → project.admin")
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
	scoped.ApplyScope(domain.NewTeamAssignmentScope(inScope.ID))
	require.NoError(t, stmts.CreateAuthzAssignment(t.Context(), scoped))

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	got := searchResults(t, client, &api.SearchRequest{
		Query: "partial",
		Types: []api.SearchResultType{
			api.SearchResultTypeUser,
			api.SearchResultTypeTeam,
			api.SearchResultTypeSchema,
			api.SearchResultTypeFlowDefinition,
			api.SearchResultTypeIdp,
		},
	}, api.SearchParams{})
	assert.Equal(t, []string{inScope.ID}, searchResultIDs(got.Results))

	// An id outside the grant is not found either.
	got = searchResults(t, client, &api.SearchRequest{
		Query: outOfScope.ID,
		Types: []api.SearchResultType{api.SearchResultTypeTeam},
	}, api.SearchParams{})
	assert.Empty(t, got.Results)
}

// Configuration is found by the names a person knows it by: a schema's title
// or object type, a flow's name, a connection's slug or display name. Their
// lists filter on none of those, so this also proves the search matches the
// page it reads.
func TestSearchConfiguration(t *testing.T) {
	t.Parallel()

	f := newIdpFixture(t)
	t.Cleanup(func() {
		_, _ = harness.EnsureServiceDB(t).Statements().DeleteProjectByID(context.Background(), f.project.ID)
	})

	schemaID := harness.CreateUserSchema(t, f.project, `{
		"title": "Partner Staff",
		"metaSchema": "https://test.example.schemas.com/schemas/user-schema.json",
		"$id": "https://search.example.com/schemas/partner-staff.json",
		"kind": "user-schema",
		"objectType": "partner-user",
		"type": "object",
		"x-identifier": "email",
		"x-auth-methods": {"password": {"enabled": true}},
		"properties": {
			"email": {"type": "string", "format": "email", "x-unique": "project"}
		}
	}`)

	flowSchema := harness.CreateUserSchema(t, f.project, harness.EnsureTestData(t).Schemas.CreateSchemaRequestUserSchema)
	flowResp, err := f.client.CreateFlowDefinition(t.Context(), newCreateFlowDefinitionRequest(
		f.projectID(), newFlowDefinitionFixture("partner-sign-in", flowSchema)))
	require.NoError(t, err)
	require.IsType(t, &api.FlowDefinitionResponse{}, flowResp, helpers.MustMarshal(t, flowResp))
	flowID := flowResp.(*api.FlowDefinitionResponse).ID

	connection := helpers.OIDCConnection("partner-sso")
	connection.DisplayName = "Partner Portal"
	idpID := f.create(t, connection).ID

	config := []api.SearchResultType{
		api.SearchResultTypeSchema,
		api.SearchResultTypeFlowDefinition,
		api.SearchResultTypeIdp,
	}
	search := func(t *testing.T, req *api.SearchRequest) *api.SearchResponse {
		t.Helper()
		return searchResults(t, f.client, req, api.SearchParams{ProjectID: api.NewOptProjectID(f.projectID())})
	}

	t.Run("finds a schema, a flow and a connection by what they are called", func(t *testing.T) {
		t.Parallel()
		got := search(t, &api.SearchRequest{Query: "PARTNER", Types: config})

		// Three prefixes, so the order is the order of the types.
		require.Equal(t, []string{schemaID, flowID, idpID}, searchResultIDs(got.Results))
		assert.Empty(t, got.IncompleteTypes)
		assert.Equal(t, api.SearchResult{
			Type:      api.SearchResultTypeSchema,
			ID:        schemaID,
			ProjectID: f.projectID(),
			Title:     "Partner Staff",
			Subtitle:  api.NewOptString("partner-user"),
		}, got.Results[0])
		assert.Equal(t, api.SearchResult{
			Type:      api.SearchResultTypeFlowDefinition,
			ID:        flowID,
			ProjectID: f.projectID(),
			Title:     "partner-sign-in",
			Subtitle:  api.NewOptString("login"),
		}, got.Results[1])
		assert.Equal(t, api.SearchResult{
			Type:      api.SearchResultTypeIdp,
			ID:        idpID,
			ProjectID: f.projectID(),
			Title:     "Partner Portal",
			Subtitle:  api.NewOptString("partner-sso"),
		}, got.Results[2])
	})

	t.Run("matches inside a document, not only a column", func(t *testing.T) {
		t.Parallel()
		// "Staff" is only in the schema's title and "Portal" only in the
		// connection's display name.
		got := search(t, &api.SearchRequest{Query: "staff", Types: config})
		assert.Equal(t, []string{schemaID}, searchResultIDs(got.Results))

		got = search(t, &api.SearchRequest{Query: "portal", Types: config})
		assert.Equal(t, []string{idpID}, searchResultIDs(got.Results))
	})

	t.Run("an id finds its resource", func(t *testing.T) {
		t.Parallel()
		for _, id := range []string{schemaID, flowID, idpID} {
			got := search(t, &api.SearchRequest{Query: id, Types: config})
			assert.Equal(t, []string{id}, searchResultIDs(got.Results), id)
		}
	})

	t.Run("configuration stays out of a search for other types", func(t *testing.T) {
		t.Parallel()
		got := search(t, &api.SearchRequest{
			Query: "partner",
			Types: []api.SearchResultType{api.SearchResultTypeUser, api.SearchResultTypeTeam},
		})
		assert.Empty(t, got.Results)
	})
}

// A Console session that names no project searches the projects the person
// can act on, the ones listMyProjects lists, and every result says which
// project it is in. Grants decide, project by project, and the search reads at
// most the first ten of them.
func TestSearchAcrossProjects(t *testing.T) {
	t.Parallel()

	platform := harness.EnsurePlatformProject(t)
	stmts := harness.EnsureServiceDB(t).Statements()
	// Only the project that holds a user needs the default schemas.
	newProject := func(t *testing.T, seedDefaults bool) string {
		t.Helper()
		project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, seedDefaults)
		require.NoError(t, err)
		t.Cleanup(func() { _, _ = stmts.DeleteProjectByID(context.Background(), project.ID) })
		return project.ID
	}
	createTeam := func(t *testing.T, projectID, name string) string {
		t.Helper()
		team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{ProjectID: projectID, Name: name})
		require.NoError(t, err)
		return team.ID
	}
	teams := []api.SearchResultType{api.SearchResultTypeTeam}

	person := harness.CreateUserWithTeam(t, platform.ID)
	viewed, administered, foreign := newProject(t, true), newProject(t, false), newProject(t, false)
	harness.SeedProjectViewer(t, viewed, person)
	harness.SeedProjectAdmin(t, administered, person)
	viewedTeam := createTeam(t, viewed, "Orbit Alpha")
	administeredTeam := createTeam(t, administered, "Orbit Beta")
	createTeam(t, foreign, "Orbit Gamma")
	viewedUser := seedSearchUser(t, viewed, "", map[string]any{"email": "orbit-ann@across.example.com"})
	client := sessionClientForUser(t, person)

	t.Run("finds matches in every project the person can act on, each in its project", func(t *testing.T) {
		t.Parallel()
		got := searchResults(t, client, &api.SearchRequest{
			Query: "orbit",
			Types: []api.SearchResultType{api.SearchResultTypeUser, api.SearchResultTypeTeam},
		}, api.SearchParams{})

		assert.ElementsMatch(t, []string{viewedUser, viewedTeam, administeredTeam}, searchResultIDs(got.Results))
		projects := map[string]api.ProjectID{}
		for _, result := range got.Results {
			projects[result.ID] = result.ProjectID
		}
		assert.Equal(t, api.ProjectID(viewed), projects[viewedTeam])
		assert.Equal(t, api.ProjectID(viewed), projects[viewedUser])
		assert.Equal(t, api.ProjectID(administered), projects[administeredTeam])
		assert.False(t, got.MoreProjects)
		assert.Empty(t, got.IncompleteTypes)
	})

	t.Run("the limit counts every project's matches together", func(t *testing.T) {
		t.Parallel()
		got := searchResults(t, client, &api.SearchRequest{Query: "orbit", Types: teams, LimitPerType: api.NewOptInt(1)},
			api.SearchParams{})
		assert.Equal(t, []string{viewedTeam}, searchResultIDs(got.Results), "Orbit Alpha reads before Orbit Beta")
		assert.Equal(t, teams, got.IncompleteTypes)
	})

	t.Run("naming a project searches it alone", func(t *testing.T) {
		t.Parallel()
		got := searchResults(t, client, &api.SearchRequest{Query: "orbit", Types: teams},
			api.SearchParams{ProjectID: api.NewOptProjectID(api.ProjectID(administered))})
		assert.Equal(t, []string{administeredTeam}, searchResultIDs(got.Results))
		assert.False(t, got.MoreProjects)
	})

	t.Run("a project the person cannot act on is not found, named or not", func(t *testing.T) {
		t.Parallel()
		resp, err := client.Search(t.Context(), &api.SearchRequest{Query: "orbit", Types: teams},
			api.SearchParams{ProjectID: api.NewOptProjectID(api.ProjectID(foreign))})
		require.NoError(t, err)
		require.IsType(t, &api.SearchNotFound{}, resp, helpers.MustMarshal(t, resp))
		assertAuthzError(t, resp, domain.ErrProjectNotFound().Code)
	})

	t.Run("a person without grants finds nothing", func(t *testing.T) {
		t.Parallel()
		got := searchResults(t, sessionClientForUser(t, harness.CreateUserWithTeam(t, platform.ID)),
			&api.SearchRequest{Query: "orbit", Types: teams}, api.SearchParams{})
		assert.Empty(t, got.Results)
		assert.False(t, got.MoreProjects)
	})

	t.Run("reads the newest ten projects and says there are more", func(t *testing.T) {
		t.Parallel()
		many := harness.CreateUserWithTeam(t, platform.ID)
		var first, last string
		for i := range 11 {
			projectID := newProject(t, false)
			harness.SeedProjectViewer(t, projectID, many)
			team := createTeam(t, projectID, "Nebula "+strconv.Itoa(i))
			if i == 0 {
				first = team
			}
			last = team
		}
		got := searchResults(t, sessionClientForUser(t, many), &api.SearchRequest{Query: "nebula", Types: teams, LimitPerType: api.NewOptInt(20)},
			api.SearchParams{})

		// The newest ten are searched, so the first one made is left out.
		assert.Len(t, got.Results, 10)
		assert.Contains(t, searchResultIDs(got.Results), last)
		assert.NotContains(t, searchResultIDs(got.Results), first)
		assert.True(t, got.MoreProjects)
		assert.Equal(t, teams, got.IncompleteTypes)
	})

	t.Run("a platform operator reads every project, bounded the same way", func(t *testing.T) {
		t.Parallel()
		operator := platformUser(t)
		grantPlatformOperator(t, operator)
		// More projects than one search reads exist whatever ran before.
		for range 11 {
			newProject(t, false)
		}
		got := searchResults(t, sessionClientForUser(t, operator), &api.SearchRequest{Query: "orbit", Types: teams},
			api.SearchParams{})
		assert.True(t, got.MoreProjects)
		assert.Equal(t, teams, got.IncompleteTypes)
	})
}
