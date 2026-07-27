//go:build postgres_integration

package postgres

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	v2database "github.com/zitadel/nextgen/internal/storage/v2/database"
)

func ensureUserTestProject(t *testing.T) (projectID, schemaURL string) {
	t.Helper()

	project := newTestProject(uniqueProjectID(t))
	require.NoError(t, testPool.CreateProject(t.Context(), project))
	t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), project.ID) })

	schemaURL = "https://example.com/schemas/test-user"
	require.NoError(t, testPool.CreateJSONSchema(t.Context(), &domain.JSONSchema{
		ProjectID: project.ID,
		URL:       schemaURL,
		Schema:    []byte(`{"type":"object"}`),
	}))
	t.Cleanup(func() {
		_ = testPool.DeleteJSONSchemaByID(context.Background(), project.ID, schemaURL)
	})
	return project.ID, schemaURL
}

func TestUserStatements_ListAndLookupHydrateAttributes(t *testing.T) {
	ctx := t.Context()
	projectID, schemaURL := ensureUserTestProject(t)

	user1 := newTestUser(t, projectID, schemaURL, "user_v2_lookup_1", "alpha@example.com", "Alpha")
	user2 := newTestUser(t, projectID, schemaURL, "user_v2_lookup_2", "beta@example.com", "Beta")
	require.NoError(t, testPool.CreateUser(ctx, user1))
	require.NoError(t, testPool.CreateUser(ctx, user2))

	list, err := testPool.ListUsers(ctx, &v2database.ListOptions[domain.UserField]{
		Filter: v2database.Equal(v2database.Col(domain.UserFieldProjectID), projectID),
		Pagination: v2database.Page[domain.UserField]{
			OrderBy: v2database.OrderBy[domain.UserField]{
				Columns:   []v2database.Column[domain.UserField]{v2database.Col(domain.UserFieldID)},
				Direction: v2database.OrderAsc,
			},
		},
	}, 0, service.UserReadOptions{
		AttributeKeys: []string{"email"},
	})
	require.NoError(t, err)
	require.Len(t, list.Items, 2)
	assert.Equal(t, []string{"user_v2_lookup_1", "user_v2_lookup_2"}, userIDs(list.Items))
	assertUserAttributes(t, list.Items[0], map[string]any{"email": "alpha@example.com"})
	assertUserAttributes(t, list.Items[1], map[string]any{"email": "beta@example.com"})

	attrs := []domain.Attribute{
		{Key: "email", Value: "alpha@example.com"},
		{Key: "name", Value: "Alpha"},
	}
	matches, err := testPool.ListUsersByAttributes(ctx, projectID, nil, attrs, service.UserReadOptions{
		AttributeKeys: []string{"email", "name"},
	})
	require.NoError(t, err)
	require.Len(t, matches.Items, 1)
	assert.Equal(t, user1.ID, matches.Items[0].ID)
	assertUserAttributes(t, matches.Items[0], map[string]any{
		"email": "alpha@example.com",
		"name":  "Alpha",
	})

	got, err := testPool.GetUserByAttributes(ctx, projectID, attrs, service.UserReadOptions{
		AttributeKeys: []string{"email", "name"},
	})
	require.NoError(t, err)
	assert.Equal(t, user1.ID, got.ID)
	assertUserAttributes(t, got, map[string]any{
		"email": "alpha@example.com",
		"name":  "Alpha",
	})
}

func TestUserStatements_ListUsersOffset(t *testing.T) {
	ctx := t.Context()
	projectID, schemaURL := ensureUserTestProject(t)

	for _, id := range []string{"user_v2_off_1", "user_v2_off_2", "user_v2_off_3"} {
		require.NoError(t, testPool.CreateUser(ctx, newTestUser(t, projectID, schemaURL, id, id+"@example.com", id)))
	}

	list, err := testPool.ListUsers(ctx, &v2database.ListOptions[domain.UserField]{
		Filter: v2database.Equal(v2database.Col(domain.UserFieldProjectID), projectID),
		Pagination: v2database.Page[domain.UserField]{
			Limit: 2,
			OrderBy: v2database.OrderBy[domain.UserField]{
				Columns:   []v2database.Column[domain.UserField]{v2database.Col(domain.UserFieldID)},
				Direction: v2database.OrderAsc,
			},
		},
	}, 1, service.UserReadOptions{AttributeKeys: []string{"email"}})
	require.NoError(t, err)
	require.Len(t, list.Items, 2)
	assert.Equal(t, []string{"user_v2_off_2", "user_v2_off_3"}, userIDs(list.Items))
}

func newTestUser(t *testing.T, projectID, schemaURL, userID, email, name string) *domain.CreateUser {
	t.Helper()

	emailAttr, err := domain.NewCreateAttribute("email", email, domain.AttributeUniquenessProject)
	require.NoError(t, err)
	nameAttr, err := domain.NewCreateAttribute("name", name, domain.AttributeUniquenessUnspecified)
	require.NoError(t, err)

	return &domain.CreateUser{
		ProjectID: projectID,
		SchemaURL: schemaURL,
		ID:        userID,
		Attributes: []*domain.CreateAttribute{
			emailAttr,
			nameAttr,
		},
	}
}

func userIDs(users []*domain.User) []string {
	ids := make([]string, len(users))
	for i, user := range users {
		ids[i] = user.ID
	}
	return ids
}

func assertUserAttributes(t *testing.T, user *domain.User, want map[string]any) {
	t.Helper()

	got := make(map[string]any, len(user.Attributes))
	for _, attr := range user.Attributes {
		got[attr.Key] = attr.Value
	}
	assert.Equal(t, want, got)
}
