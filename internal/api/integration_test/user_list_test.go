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
// created users afterwards newest-first, a page-token window, and no
// cross-project leakage.
func TestListUsers(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	team, err := harness.EnsureTeamService(t).Create(t.Context(), service.CreateTeamInput{
		ProjectID: project.ID,
		Name:      helpers.TeamName(),
	})
	require.NoError(t, err)
	schemaURL := apischemas.DefaultHumanUserSchemaURL(helpers.BuiltinSchemaBaseURL)

	client, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, client, project)

	listUsers := func(t *testing.T, params api.ListUsersParams) *api.ListUsersResponse {
		t.Helper()
		res, err := client.ListUsers(t.Context(), params)
		require.NoError(t, err)
		require.IsType(t, &api.ListUsersResponse{}, res, helpers.MustMarshal(t, res))
		return res.(*api.ListUsersResponse)
	}
	listIDs := func(t *testing.T, params api.ListUsersParams) []string {
		t.Helper()
		list := listUsers(t, params)
		ids := make([]string, 0, len(list.Users))
		for _, item := range list.Users {
			ids = append(ids, userID(t, item))
		}
		return ids
	}

	// A fresh project lists no users — the probe's "verify login first" stage.
	empty := listUsers(t, api.ListUsersParams{})
	assert.Empty(t, empty.Users)
	assert.False(t, empty.NextPageToken.IsSet(), "a short page carries no cursor")

	// Seed two users in creation order.
	users := harness.EnsureUserFixture(t)
	for i, id := range []string{"user_list-user-01", "user_list-user-02"} {
		emailAttr, err := domain.NewCreateAttribute(
			"email", fmt.Sprintf("list-%d@example.com", i), domain.AttributeUniquenessProject)
		require.NoError(t, err)
		require.NoError(t, users.Create(t.Context(), &domain.CreateUser{
			ProjectID:               project.ID,
			SchemaURL:               schemaURL,
			ID:                      id,
			InitialMembershipTeamID: &team.ID,
			Attributes:              domain.CreateAttributes{*emailAttr},
		}))
	}

	// Full list: newest first, attributes hydrated, metadata attached.
	list := listUsers(t, api.ListUsersParams{})
	require.Len(t, list.Users, 2)
	assert.False(t, list.NextPageToken.IsSet(), "the whole result fits in one page")

	newest := list.Users[0]
	assert.Equal(t, "user_list-user-02", userID(t, newest))
	assert.Equal(t, "list-1@example.com", userProp(t, newest, "email"))
	assert.Equal(t, schemaURL, newest.Schema)

	metadata := newest.Metadata
	assert.Equal(t, api.UserMetadataStatusActive, metadata.Status)
	assert.False(t, metadata.CreatedAt.IsZero())
	assert.False(t, metadata.UpdatedAt.Before(metadata.CreatedAt))

	assert.Equal(t, []string{"user_list-user-02", "user_list-user-01"}, listIDs(t, api.ListUsersParams{}),
		"users are ordered newest first")

	// The window walks backwards through creation time, one page at a time.
	firstPage := listUsers(t, api.ListUsersParams{Limit: api.NewOptLimit(1)})
	require.Len(t, firstPage.Users, 1)
	assert.Equal(t, "user_list-user-02", userID(t, firstPage.Users[0]))
	pageToken, ok := firstPage.NextPageToken.Get()
	require.True(t, ok, "a full page carries a cursor")

	secondPage := listUsers(t, api.ListUsersParams{
		Limit:     api.NewOptLimit(1),
		PageToken: api.NewOptPageToken(pageToken),
	})
	require.Len(t, secondPage.Users, 1)
	assert.Equal(t, "user_list-user-01", userID(t, secondPage.Users[0]))

	// The second page is full too, so it carries a cursor of its own; only the
	// page past the end reports that there is nothing more.
	pageToken, ok = secondPage.NextPageToken.Get()
	require.True(t, ok, "a full page carries a cursor even when it is the last one")

	thirdPage := listUsers(t, api.ListUsersParams{
		Limit:     api.NewOptLimit(1),
		PageToken: api.NewOptPageToken(pageToken),
	})
	assert.Empty(t, thirdPage.Users)
	assert.False(t, thirdPage.NextPageToken.IsSet())

	// Another project's bearer sees nothing: scope comes from the token, so
	// the same call answers with that project's (empty) user list.
	other, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)
	otherClient, err := helpers.NewApiClient(harness.EnsureTestServer(t).URL)
	require.NoError(t, err)
	harness.SetProjectSecretOnApiClient(t, otherClient, other)

	otherRes, err := otherClient.ListUsers(t.Context(), api.ListUsersParams{})
	require.NoError(t, err)
	require.IsType(t, &api.ListUsersResponse{}, otherRes, helpers.MustMarshal(t, otherRes))
	assert.Empty(t, otherRes.(*api.ListUsersResponse).Users)
}

// userID reads the listed user's id, which the API carries on the envelope
// rather than as part of the schema-defined content.
func userID(t *testing.T, user api.User) string {
	t.Helper()

	return string(user.ID)
}

// userProp reads a string property off a listed user. Everything the user
// schema defines arrives under attributes; id, schema and metadata are the
// envelope around it.
func userProp(t *testing.T, user api.User, key string) string {
	t.Helper()

	raw, ok := user.Attributes[key]
	require.True(t, ok, "user item carries no %q: %s", key, helpers.MustMarshal(t, user))
	var value string
	require.NoError(t, json.Unmarshal(raw, &value))
	return value
}
