//go:build postgres_integration || spanner_integration

package integration_test

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
	apischemas "github.com/zitadel/nextgen/api/openapi/endpoints/schemas"
	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// GET /users is the CLI status probe's endpoint: bearer = project secret,
// no project parameter — the oauth2 principal is the only scope. This is
// the HTTP e2e for exactly that call shape: empty on a fresh project, the
// created users afterwards, a stable creation-ordered window, and no
// cross-project leakage.
func TestListUsers(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	team, err := harness.EnsureTeamService(t).CreateTeam(t.Context(), service.CreateTeamInput{
		ProjectID: project.ID,
		Name:      helpers.TeamName(),
	})
	require.NoError(t, err)
	schemaURL := apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	listIDs := func(t *testing.T, params api.ListUsersParams) []string {
		t.Helper()
		res, err := client.ListUsers(t.Context(), params)
		require.NoError(t, err)
		require.IsType(t, &api.ListUsersOKApplicationJSON{}, res, helpers.MustMarshal(t, res))
		items := res.(*api.ListUsersOKApplicationJSON)
		ids := make([]string, 0, len(*items))
		for _, item := range *items {
			raw, ok := item["id"]
			require.True(t, ok, "user item carries no id: %v", item)
			var id string
			require.NoError(t, json.Unmarshal(raw, &id))
			ids = append(ids, id)
		}
		return ids
	}

	// A fresh project lists no users — the probe's "verify login first" stage.
	assert.Empty(t, listIDs(t, api.ListUsersParams{}))

	// Seed two users in creation order.
	users := harness.EnsureUserFixture(t)
	for i, id := range []string{"list-user-01", "list-user-02"} {
		emailAttr, err := domain.NewCreateAttribute(
			"email", fmt.Sprintf("list-%d@example.com", i), domain.AttributeUniquenessProject)
		require.NoError(t, err)
		require.NoError(t, users.Create(t.Context(), &domain.CreateUser{
			ProjectID:               project.ID,
			SchemaURL:               schemaURL,
			ID:                      id,
			InitialMembershipTeamID: &team.ID,
			Attributes:              []*domain.CreateAttribute{emailAttr},
		}))
	}

	// Full list, creation-ordered, attributes hydrated.
	res, err := client.ListUsers(t.Context(), api.ListUsersParams{})
	require.NoError(t, err)
	require.IsType(t, &api.ListUsersOKApplicationJSON{}, res, helpers.MustMarshal(t, res))
	items := res.(*api.ListUsersOKApplicationJSON)
	require.Len(t, *items, 2)
	var email string
	require.NoError(t, json.Unmarshal((*items)[0]["email"], &email))
	assert.Equal(t, "list-0@example.com", email)
	assert.Equal(t, []string{"list-user-01", "list-user-02"}, listIDs(t, api.ListUsersParams{}))

	// The window is stable: limit takes the head, offset skips past it.
	assert.Equal(t, []string{"list-user-01"}, listIDs(t, api.ListUsersParams{
		Limit: api.NewOptLimit(1),
	}))
	assert.Equal(t, []string{"list-user-02"}, listIDs(t, api.ListUsersParams{
		Offset: api.NewOptInt(1),
		Limit:  api.NewOptLimit(1),
	}))

	// Another project's bearer sees nothing: scope comes from the token.
	other, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	otherClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, otherClient, other)
	otherRes, err := otherClient.ListUsers(t.Context(), api.ListUsersParams{})
	require.NoError(t, err)
	if assert.IsType(t, &api.ListUsersOKApplicationJSON{}, otherRes, helpers.MustMarshal(t, otherRes)) {
		otherItems := otherRes.(*api.ListUsersOKApplicationJSON)
		assert.Empty(t, *otherItems)
	}
}
