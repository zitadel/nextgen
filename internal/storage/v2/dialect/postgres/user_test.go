//go:build postgres_integration

package postgres

import (
	"context"
	"fmt"
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
	}, service.UserQueryOptions{
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
	matches, err := testPool.ListUsers(ctx, &v2database.ListOptions[domain.UserField]{
		Filter: v2database.Equal(v2database.Col(domain.UserFieldProjectID), projectID),
	}, service.UserQueryOptions{
		Attributes:    attrs,
		AttributeKeys: []string{"email", "name"},
	})
	require.NoError(t, err)
	require.Len(t, matches.Items, 1)
	assert.Equal(t, user1.ID, matches.Items[0].ID)
	assertUserAttributes(t, matches.Items[0], map[string]any{
		"email": "alpha@example.com",
		"name":  "Alpha",
	})

	got, err := testPool.GetUser(ctx,
		v2database.Equal(v2database.Col(domain.UserFieldProjectID), projectID),
		service.UserQueryOptions{
			Attributes:    attrs,
			AttributeKeys: []string{"email", "name"},
		},
	)
	require.NoError(t, err)
	assert.Equal(t, user1.ID, got.ID)
	assertUserAttributes(t, got, map[string]any{
		"email": "alpha@example.com",
		"name":  "Alpha",
	})
}

func TestUserStatements_ListUsersAttributesAndAttributeKeys(t *testing.T) {
	ctx := t.Context()
	projectID, schemaURL := ensureUserTestProject(t)

	user1 := newTestUser(t, projectID, schemaURL, "user_attr_1", "alpha@example.com", "Alpha")
	user2 := newTestUser(t, projectID, schemaURL, "user_attr_2", "beta@example.com", "Beta")
	require.NoError(t, testPool.CreateUser(ctx, user1))
	require.NoError(t, testPool.CreateUser(ctx, user2))

	projectFilter := v2database.Equal(v2database.Col(domain.UserFieldProjectID), projectID)
	orderByID := v2database.Page[domain.UserField]{
		OrderBy: v2database.OrderBy[domain.UserField]{
			Columns:   []v2database.Column[domain.UserField]{v2database.Col(domain.UserFieldID)},
			Direction: v2database.OrderAsc,
		},
	}

	t.Run("AttributesMatchOnly", func(t *testing.T) {
		list, err := testPool.ListUsers(ctx, &v2database.ListOptions[domain.UserField]{
			Filter: projectFilter,
		}, service.UserQueryOptions{
			Attributes: []domain.Attribute{{Key: "email", Value: "alpha@example.com"}},
		})
		require.NoError(t, err)
		require.Len(t, list.Items, 1)
		assert.Equal(t, user1.ID, list.Items[0].ID)
		assertUserAttributes(t, list.Items[0], map[string]any{
			"email": "alpha@example.com",
			"name":  "Alpha",
		})
	})

	t.Run("AttributesMatchWithSubsetAttributeKeys", func(t *testing.T) {
		list, err := testPool.ListUsers(ctx, &v2database.ListOptions[domain.UserField]{
			Filter: projectFilter,
		}, service.UserQueryOptions{
			Attributes: []domain.Attribute{
				{Key: "email", Value: "alpha@example.com"},
				{Key: "name", Value: "Alpha"},
			},
			AttributeKeys: []string{"email"},
		})
		require.NoError(t, err)
		require.Len(t, list.Items, 1)
		assert.Equal(t, user1.ID, list.Items[0].ID)
		assertUserAttributes(t, list.Items[0], map[string]any{
			"email": "alpha@example.com",
		})
	})

	t.Run("AttributeKeysOnlyHydrate", func(t *testing.T) {
		list, err := testPool.ListUsers(ctx, &v2database.ListOptions[domain.UserField]{
			Filter:     projectFilter,
			Pagination: orderByID,
		}, service.UserQueryOptions{
			AttributeKeys: []string{"name"},
		})
		require.NoError(t, err)
		require.Len(t, list.Items, 2)
		assert.Equal(t, []string{"user_attr_1", "user_attr_2"}, userIDs(list.Items))
		assertUserAttributes(t, list.Items[0], map[string]any{"name": "Alpha"})
		assertUserAttributes(t, list.Items[1], map[string]any{"name": "Beta"})
	})
}

func TestUserStatements_ListUsersUnifiedFilters(t *testing.T) {
	ctx := t.Context()
	projectID, schemaURL := ensureUserTestProject(t)
	teamID := "team_unified_filters"

	require.NoError(t, testPool.CreateTeam(ctx, newTestTeam(projectID, teamID)))

	orderByID := v2database.Page[domain.UserField]{
		OrderBy: v2database.OrderBy[domain.UserField]{
			Columns:   []v2database.Column[domain.UserField]{v2database.Col(domain.UserFieldID)},
			Direction: v2database.OrderAsc,
		},
	}
	projectFilter := v2database.Equal(v2database.Col(domain.UserFieldProjectID), projectID)

	t.Run("AttributesAndLimit", func(t *testing.T) {
		for _, spec := range []struct {
			id, email, name string
		}{
			{"user_unified_1", "u1@example.com", "User One"},
			{"user_unified_2", "u2@example.com", "User Two"},
			{"user_unified_3", "u3@example.com", "User Three"},
		} {
			user := newTestUserWithRole(t, projectID, schemaURL, spec.id, spec.email, spec.name, "member")
			require.NoError(t, testPool.CreateUser(ctx, user))
		}

		page, err := testPool.ListUsers(ctx, &v2database.ListOptions[domain.UserField]{
			Filter: projectFilter,
			Pagination: v2database.Page[domain.UserField]{
				OrderBy: orderByID.OrderBy,
				Limit:   2,
			},
		}, service.UserQueryOptions{
			Attributes: []domain.Attribute{{Key: "role", Value: "member"}},
		})
		require.NoError(t, err)
		require.Len(t, page.Items, 2)
		assert.NotEmpty(t, page.NextCursor)
		assert.Equal(t, []string{"user_unified_1", "user_unified_2"}, userIDs(page.Items))

		page2, err := testPool.ListUsers(ctx, &v2database.ListOptions[domain.UserField]{
			Filter: projectFilter,
			Pagination: v2database.Page[domain.UserField]{
				OrderBy: orderByID.OrderBy,
				Limit:   2,
				Cursor:  page.NextCursor,
			},
		}, service.UserQueryOptions{
			Attributes: []domain.Attribute{{Key: "role", Value: "member"}},
		})
		require.NoError(t, err)
		require.Len(t, page2.Items, 1)
		assert.Equal(t, "user_unified_3", page2.Items[0].ID)
	})

	t.Run("AttributesAndMembershipTeamID", func(t *testing.T) {
		member := newTestUserWithRole(t, projectID, schemaURL, "user_member", "member@example.com", "Member", "worker")
		nonMember := newTestUserWithRole(t, projectID, schemaURL, "user_non_member", "nonmember@example.com", "Non Member", "worker")
		require.NoError(t, testPool.CreateUser(ctx, member))
		require.NoError(t, testPool.CreateUser(ctx, nonMember))
		require.NoError(t, testPool.CreateTeamMembership(ctx, &domain.TeamMembership{
			ProjectID: projectID,
			TeamID:    teamID,
			UserID:    member.ID,
			Status:    domain.MembershipStatusActive,
		}))

		list, err := testPool.ListUsers(ctx, &v2database.ListOptions[domain.UserField]{
			Filter: projectFilter,
			Pagination: v2database.Page[domain.UserField]{
				OrderBy: orderByID.OrderBy,
			},
		}, service.UserQueryOptions{
			Attributes:       []domain.Attribute{{Key: "role", Value: "worker"}},
			MembershipTeamID: &teamID,
		})
		require.NoError(t, err)
		require.Len(t, list.Items, 1)
		assert.Equal(t, member.ID, list.Items[0].ID)
	})

	t.Run("MembershipTeamIDAndLimit", func(t *testing.T) {
		for i, id := range []string{"user_limit_1", "user_limit_2", "user_limit_3", "user_limit_4"} {
			user := newTestUser(t, projectID, schemaURL, id, fmt.Sprintf("limit%d@example.com", i+1), fmt.Sprintf("Limit %d", i+1))
			require.NoError(t, testPool.CreateUser(ctx, user))
			if id != "user_limit_4" {
				require.NoError(t, testPool.CreateTeamMembership(ctx, &domain.TeamMembership{
					ProjectID: projectID,
					TeamID:    teamID,
					UserID:    id,
					Status:    domain.MembershipStatusActive,
				}))
			}
		}

		list, err := testPool.ListUsers(ctx, &v2database.ListOptions[domain.UserField]{
			Filter: projectFilter,
			Pagination: v2database.Page[domain.UserField]{
				OrderBy: orderByID.OrderBy,
				Limit:   2,
			},
		}, service.UserQueryOptions{
			MembershipTeamID: &teamID,
		})
		require.NoError(t, err)
		require.Len(t, list.Items, 2)
		assert.Equal(t, []string{"user_limit_1", "user_limit_2"}, userIDs(list.Items))
	})
}

func newTestUserWithRole(t *testing.T, projectID, schemaURL, userID, email, name, role string) *domain.CreateUser {
	t.Helper()

	user := newTestUser(t, projectID, schemaURL, userID, email, name)
	roleAttr, err := domain.NewCreateAttribute("role", role, domain.AttributeUniquenessUnspecified)
	require.NoError(t, err)
	user.Attributes = append(user.Attributes, roleAttr)
	return user
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
