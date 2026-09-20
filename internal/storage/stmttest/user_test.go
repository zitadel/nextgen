//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func ensureUserTestProject(t *testing.T, stmts service.AllStatements) (projectID, schemaURL string) {
	t.Helper()

	project := newTestProject(uniqueProjectID(t))
	require.NoError(t, stmts.CreateProject(t.Context(), project))
	t.Cleanup(func() { _, _ = stmts.DeleteProjectByID(context.Background(), project.ID) })

	schemaURL = "https://example.com/schemas/test-user"
	require.NoError(t, stmts.CreateJSONSchema(t.Context(), &domain.JSONSchema{
		ProjectID: project.ID,
		URL:       schemaURL,
		Schema:    []byte(`{"type":"object"}`),
	}))
	t.Cleanup(func() {
		_ = stmts.DeleteJSONSchemaByID(context.Background(), project.ID, schemaURL)
	})
	return project.ID, schemaURL
}

func TestUserStatements_Create_EmptyIDAssigned(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)

		user := newTestUser(t, projectID, schemaURL, "", "empty-id@example.com", "EmptyID")
		require.NoError(t, d.stmts.CreateUser(t.Context(), user))
		require.NotEmpty(t, user.ID)
		assert.True(t, strings.HasPrefix(user.ID, string(domain.PrefixUser)+"_"))

		got, err := d.stmts.GetUser(t.Context(),
			database.And(
				database.Equal(database.Col(domain.UserFieldProjectID), projectID),
				database.Equal(database.Col(domain.UserFieldID), user.ID),
			),
			service.UserQueryOptions{},
		)
		require.NoError(t, err)
		assert.Equal(t, user.ID, got.ID)
	})
}

func TestUserStatements_ListAndLookupHydrateAttributes(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)

		user1 := newTestUser(t, projectID, schemaURL, "user_v2_lookup_1", "alpha@example.com", "Alpha")
		user2 := newTestUser(t, projectID, schemaURL, "user_v2_lookup_2", "beta@example.com", "Beta")
		require.NoError(t, d.stmts.CreateUser(t.Context(), user1))
		require.NoError(t, d.stmts.CreateUser(t.Context(), user2))

		list, err := d.stmts.ListUsers(unfilteredListCtx(t), &database.ListOptions[domain.UserField]{
			Filter: database.Equal(database.Col(domain.UserFieldProjectID), projectID),
			Pagination: database.Page[domain.UserField]{
				OrderBy: database.OrderBy[domain.UserField]{
					Columns:   []database.Column[domain.UserField]{database.Col(domain.UserFieldID)},
					Direction: database.OrderAsc,
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
		matches, err := d.stmts.ListUsers(unfilteredListCtx(t), &database.ListOptions[domain.UserField]{
			Filter: database.Equal(database.Col(domain.UserFieldProjectID), projectID),
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

		got, err := d.stmts.GetUser(t.Context(),
			database.Equal(database.Col(domain.UserFieldProjectID), projectID),
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
	})
}

func TestUserStatements_ListUsersAttributesAndAttributeKeys(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)

		user1 := newTestUser(t, projectID, schemaURL, "user_attr_1", "alpha@example.com", "Alpha")
		user2 := newTestUser(t, projectID, schemaURL, "user_attr_2", "beta@example.com", "Beta")
		require.NoError(t, d.stmts.CreateUser(t.Context(), user1))
		require.NoError(t, d.stmts.CreateUser(t.Context(), user2))

		projectFilter := database.Equal(database.Col(domain.UserFieldProjectID), projectID)
		orderByID := database.Page[domain.UserField]{
			OrderBy: database.OrderBy[domain.UserField]{
				Columns:   []database.Column[domain.UserField]{database.Col(domain.UserFieldID)},
				Direction: database.OrderAsc,
			},
		}

		t.Run("AttributesMatchOnly", func(t *testing.T) {
			list, err := d.stmts.ListUsers(unfilteredListCtx(t), &database.ListOptions[domain.UserField]{
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
			list, err := d.stmts.ListUsers(unfilteredListCtx(t), &database.ListOptions[domain.UserField]{
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
			assertUserAttributes(t, list.Items[0], map[string]any{"email": "alpha@example.com"})
		})

		t.Run("AttributeKeysOnlyHydrate", func(t *testing.T) {
			list, err := d.stmts.ListUsers(unfilteredListCtx(t), &database.ListOptions[domain.UserField]{
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
	})
}

func TestUserStatements_ListUsersUnifiedFilters(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)
		teamID := "team_unified_filters"

		require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamID)))

		orderByID := database.Page[domain.UserField]{
			OrderBy: database.OrderBy[domain.UserField]{
				Columns:   []database.Column[domain.UserField]{database.Col(domain.UserFieldID)},
				Direction: database.OrderAsc,
			},
		}
		projectFilter := database.Equal(database.Col(domain.UserFieldProjectID), projectID)

		t.Run("AttributesAndLimit", func(t *testing.T) {
			for _, spec := range []struct {
				id, email, name string
			}{
				{"user_unified_1", "u1@example.com", "User One"},
				{"user_unified_2", "u2@example.com", "User Two"},
				{"user_unified_3", "u3@example.com", "User Three"},
			} {
				user := newTestUserWithRole(t, projectID, schemaURL, spec.id, spec.email, spec.name, "member")
				require.NoError(t, d.stmts.CreateUser(t.Context(), user))
			}

			page, err := d.stmts.ListUsers(unfilteredListCtx(t), &database.ListOptions[domain.UserField]{
				Filter: projectFilter,
				Pagination: database.Page[domain.UserField]{
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

			page2, err := d.stmts.ListUsers(unfilteredListCtx(t), &database.ListOptions[domain.UserField]{
				Filter: projectFilter,
				Pagination: database.Page[domain.UserField]{
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
			require.NoError(t, d.stmts.CreateUser(t.Context(), member))
			require.NoError(t, d.stmts.CreateUser(t.Context(), nonMember))
			require.NoError(t, d.stmts.CreateTeamMembership(t.Context(), &domain.TeamMembership{
				ProjectID: projectID,
				TeamID:    teamID,
				UserID:    member.ID,
				Status:    domain.MembershipStatusActive,
			}))

			list, err := d.stmts.ListUsers(unfilteredListCtx(t), &database.ListOptions[domain.UserField]{
				Filter: projectFilter,
				Pagination: database.Page[domain.UserField]{
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
				require.NoError(t, d.stmts.CreateUser(t.Context(), user))
				if id != "user_limit_4" {
					require.NoError(t, d.stmts.CreateTeamMembership(t.Context(), &domain.TeamMembership{
						ProjectID: projectID,
						TeamID:    teamID,
						UserID:    id,
						Status:    domain.MembershipStatusActive,
					}))
				}
			}

			list, err := d.stmts.ListUsers(unfilteredListCtx(t), &database.ListOptions[domain.UserField]{
				Filter: projectFilter,
				Pagination: database.Page[domain.UserField]{
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
	})
}

func TestUserStatements_UserExists(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)

		user := newTestUser(t, projectID, schemaURL, "user_exists_1", "exists@example.com", "Exists")
		require.NoError(t, d.stmts.CreateUser(t.Context(), user))

		t.Run("existing user", func(t *testing.T) {
			exists, err := d.stmts.UserExists(t.Context(), projectID, user.ID)
			require.NoError(t, err)
			assert.True(t, exists)
		})

		t.Run("unknown user is false, not an error", func(t *testing.T) {
			exists, err := d.stmts.UserExists(t.Context(), projectID, "user_exists_missing")
			require.NoError(t, err)
			assert.False(t, exists)
		})

		t.Run("user of another project is false", func(t *testing.T) {
			otherProjectID, _ := ensureUserTestProject(t, d.stmts)

			exists, err := d.stmts.UserExists(t.Context(), otherProjectID, user.ID)
			require.NoError(t, err)
			assert.False(t, exists)
		})
	})
}

func newTestUserWithRole(t *testing.T, projectID, schemaURL, userID, email, name, role string) *domain.CreateUser {
	t.Helper()

	user := newTestUser(t, projectID, schemaURL, userID, email, name)
	roleAttr, err := domain.NewCreateAttribute("role", role, domain.AttributeUniquenessUnspecified)
	require.NoError(t, err)
	user.Attributes = append(user.Attributes, *roleAttr)
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
		Attributes: []domain.CreateAttribute{
			*emailAttr,
			*nameAttr,
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
		got[string(attr.Key)] = attr.Value
	}
	assert.Equal(t, want, got)
}

func getUserByID(t *testing.T, stmts service.AllStatements, projectID, userID string) *domain.User {
	t.Helper()

	got, err := stmts.GetUser(t.Context(), database.And(
		database.Equal(database.Col(domain.UserFieldProjectID), projectID),
		database.Equal(database.Col(domain.UserFieldID), userID),
	), service.UserQueryOptions{})
	require.NoError(t, err)
	return got
}

// patchStateOf builds the post-merge state a patch writes, guarded by the
// given user's current updated_at, with registry scopes resolved from the
// stored rows the same way the service does.
func patchStateOf(t *testing.T, stmts service.AllStatements, user *domain.User, attrs ...domain.CreateAttribute) *domain.PatchUser {
	t.Helper()

	teamScope := ""
	if user.LifecycleOwnerTeamID != nil {
		teamScope = *user.LifecycleOwnerTeamID
	}
	stored, err := stmts.GetUserUniqueAttributeScopes(t.Context(), user.ProjectID, user.ID)
	require.NoError(t, err)
	return &domain.PatchUser{
		ProjectID:          user.ProjectID,
		UserID:             user.ID,
		SchemaURL:          user.SchemaURL,
		ExpectedUpdatedAt:  user.Metadata.UpdatedAt,
		Attributes:         attrs,
		AttributeTeamScope: teamScope,
		RegistryTeamScopes: domain.CreateAttributes(attrs).RegistryTeamScopes(stored, teamScope),
	}
}

func TestUserStatements_PatchUser(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)

		mustAttr := func(key domain.AttributeKey, value any, scope domain.AttributeUniqueness) domain.CreateAttribute {
			attr, err := domain.NewCreateAttribute(key, value, scope)
			require.NoError(t, err)
			return *attr
		}

		t.Run("rewrites to the given state and bumps the guard", func(t *testing.T) {
			user := newTestUser(t, projectID, schemaURL, "user_patch_rw", "patch-rw@example.com", "Before")
			require.NoError(t, d.stmts.CreateUser(t.Context(), user))
			before := getUserByID(t, d.stmts, projectID, user.ID)

			patched := patchStateOf(t, d.stmts, before,
				mustAttr("email", "patch-rw-new@example.com", domain.AttributeUniquenessProject),
				mustAttr("role", "admin", domain.AttributeUniquenessUnspecified),
			)
			require.NoError(t, d.stmts.PatchUser(t.Context(), patched))

			after := getUserByID(t, d.stmts, projectID, user.ID)
			assertUserAttributes(t, after, map[string]any{
				"email": "patch-rw-new@example.com",
				"role":  "admin",
			})
			assert.Equal(t, schemaURL, after.SchemaURL)

			// The guard moved with the write: replaying the patch against the
			// pre-patch updated_at writes nothing.
			err := d.stmts.PatchUser(t.Context(), patchStateOf(t, d.stmts, before,
				mustAttr("email", "patch-rw-replay@example.com", domain.AttributeUniquenessProject),
			))
			var noRow *database.NoRowFoundError
			require.ErrorAs(t, err, &noRow)
			assertUserAttributes(t, getUserByID(t, d.stmts, projectID, user.ID), map[string]any{
				"email": "patch-rw-new@example.com",
				"role":  "admin",
			})
		})

		t.Run("frees the old unique value and claims the new", func(t *testing.T) {
			user := newTestUser(t, projectID, schemaURL, "user_patch_claim", "claim-old@example.com", "Claimer")
			require.NoError(t, d.stmts.CreateUser(t.Context(), user))
			before := getUserByID(t, d.stmts, projectID, user.ID)

			require.NoError(t, d.stmts.PatchUser(t.Context(), patchStateOf(t, d.stmts, before,
				mustAttr("email", "claim-new@example.com", domain.AttributeUniquenessProject),
			)))

			// The old value is claimable again ...
			freed := newTestUser(t, projectID, schemaURL, "user_patch_claim2", "claim-old@example.com", "Newcomer")
			require.NoError(t, d.stmts.CreateUser(t.Context(), freed))

			// ... and the new one is held.
			taken := newTestUser(t, projectID, schemaURL, "user_patch_claim3", "claim-new@example.com", "TooLate")
			err := d.stmts.CreateUser(t.Context(), taken)
			var uniqueErr *database.UniqueError
			require.ErrorAs(t, err, &uniqueErr)
		})

		t.Run("a collision with another user's claim writes nothing", func(t *testing.T) {
			userA := newTestUser(t, projectID, schemaURL, "user_patch_col_a", "collide-a@example.com", "A")
			userB := newTestUser(t, projectID, schemaURL, "user_patch_col_b", "collide-b@example.com", "B")
			require.NoError(t, d.stmts.CreateUser(t.Context(), userA))
			require.NoError(t, d.stmts.CreateUser(t.Context(), userB))
			beforeB := getUserByID(t, d.stmts, projectID, userB.ID)

			err := d.stmts.PatchUser(t.Context(), patchStateOf(t, d.stmts, beforeB,
				mustAttr("email", "collide-a@example.com", domain.AttributeUniquenessProject),
				mustAttr("name", "B", domain.AttributeUniquenessUnspecified),
			))
			var uniqueErr *database.UniqueError
			require.ErrorAs(t, err, &uniqueErr)

			// The failed patch rolled back entirely: attributes are untouched
			// and the guard did not move, so the same read still authorizes a
			// write.
			assertUserAttributes(t, getUserByID(t, d.stmts, projectID, userB.ID), map[string]any{
				"email": "collide-b@example.com",
				"name":  "B",
			})
			require.NoError(t, d.stmts.PatchUser(t.Context(), patchStateOf(t, d.stmts, beforeB,
				mustAttr("email", "collide-c@example.com", domain.AttributeUniquenessProject),
				mustAttr("name", "B", domain.AttributeUniquenessUnspecified),
			)))
		})

		t.Run("an unchanged unique value survives the rewrite", func(t *testing.T) {
			user := newTestUser(t, projectID, schemaURL, "user_patch_keep", "keep@example.com", "Keeper")
			require.NoError(t, d.stmts.CreateUser(t.Context(), user))
			before := getUserByID(t, d.stmts, projectID, user.ID)

			require.NoError(t, d.stmts.PatchUser(t.Context(), patchStateOf(t, d.stmts, before,
				mustAttr("email", "keep@example.com", domain.AttributeUniquenessProject),
				mustAttr("role", "admin", domain.AttributeUniquenessUnspecified),
			)))

			// The claim still resolves and still defends.
			got, err := d.stmts.GetUser(t.Context(),
				database.Equal(database.Col(domain.UserFieldProjectID), projectID),
				service.UserQueryOptions{
					Attributes:           []domain.Attribute{{Key: "email", Value: "keep@example.com"}},
					UniqueAttributesOnly: true,
				},
			)
			require.NoError(t, err)
			assert.Equal(t, user.ID, got.ID)

			dup := newTestUser(t, projectID, schemaURL, "user_patch_keep2", "keep@example.com", "Impostor")
			err = d.stmts.CreateUser(t.Context(), dup)
			var uniqueErr *database.UniqueError
			require.ErrorAs(t, err, &uniqueErr)
		})

		// Create scopes team-unique claims to the initial membership team; a
		// patch has no membership context and must not silently re-scope an
		// existing claim to its own fallback (project-wide here, the user
		// being self-owned).
		t.Run("preserves the stored team scope of unique claims", func(t *testing.T) {
			team := newTestTeam(projectID, "team_patch_scope")
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))

			user := &domain.CreateUser{
				ProjectID:               projectID,
				SchemaURL:               schemaURL,
				ID:                      "user_patch_scope",
				InitialMembershipTeamID: &team.ID,
				Attributes: domain.CreateAttributes{
					mustAttr("email", "patch-scope@example.com", domain.AttributeUniquenessProject),
					mustAttr("handle", "scoped-handle", domain.AttributeUniquenessTeam),
				},
			}
			require.NoError(t, d.stmts.CreateUser(t.Context(), user))
			before := getUserByID(t, d.stmts, projectID, user.ID)

			require.NoError(t, d.stmts.PatchUser(t.Context(), patchStateOf(t, d.stmts, before,
				mustAttr("email", "patch-scope@example.com", domain.AttributeUniquenessProject),
				mustAttr("handle", "scoped-handle", domain.AttributeUniquenessTeam),
				mustAttr("role", "admin", domain.AttributeUniquenessUnspecified),
			)))

			// Had the rewrite re-scoped the claim project-wide, this scopeless
			// claimant would collide with it.
			unscoped := &domain.CreateUser{
				ProjectID: projectID,
				SchemaURL: schemaURL,
				ID:        "user_patch_scope2",
				Attributes: domain.CreateAttributes{
					mustAttr("handle", "scoped-handle", domain.AttributeUniquenessTeam),
				},
			}
			require.NoError(t, d.stmts.CreateUser(t.Context(), unscoped),
				"the claim must still be scoped to the membership team, not project-wide")

			// And within the original team the claim still defends.
			sameTeam := &domain.CreateUser{
				ProjectID:               projectID,
				SchemaURL:               schemaURL,
				ID:                      "user_patch_scope3",
				InitialMembershipTeamID: &team.ID,
				Attributes: domain.CreateAttributes{
					mustAttr("handle", "scoped-handle", domain.AttributeUniquenessTeam),
				},
			}
			err := d.stmts.CreateUser(t.Context(), sameTeam)
			var uniqueErr *database.UniqueError
			require.ErrorAs(t, err, &uniqueErr)
		})

		t.Run("moves the schema pointer", func(t *testing.T) {
			const schemaURLv2 = "https://example.com/schemas/test-user-v2"
			require.NoError(t, d.stmts.CreateJSONSchema(t.Context(), &domain.JSONSchema{
				ProjectID: projectID,
				URL:       schemaURLv2,
				Schema:    []byte(`{"type":"object"}`),
			}))
			t.Cleanup(func() {
				_ = d.stmts.DeleteJSONSchemaByID(context.Background(), projectID, schemaURLv2)
			})

			user := newTestUser(t, projectID, schemaURL, "user_patch_schema", "patch-schema@example.com", "Mover")
			require.NoError(t, d.stmts.CreateUser(t.Context(), user))
			before := getUserByID(t, d.stmts, projectID, user.ID)

			patched := patchStateOf(t, d.stmts, before,
				mustAttr("email", "patch-schema@example.com", domain.AttributeUniquenessProject),
			)
			patched.SchemaURL = schemaURLv2
			require.NoError(t, d.stmts.PatchUser(t.Context(), patched))

			assert.Equal(t, schemaURLv2, getUserByID(t, d.stmts, projectID, user.ID).SchemaURL)
		})

		t.Run("an unknown user writes nothing", func(t *testing.T) {
			err := d.stmts.PatchUser(t.Context(), &domain.PatchUser{
				ProjectID:         projectID,
				UserID:            "user_patch_missing",
				SchemaURL:         schemaURL,
				ExpectedUpdatedAt: time.Now(),
				Attributes: domain.CreateAttributes{
					mustAttr("email", "missing@example.com", domain.AttributeUniquenessProject),
				},
				RegistryTeamScopes: []string{""},
			})
			var noRow *database.NoRowFoundError
			require.ErrorAs(t, err, &noRow)
		})
	})
}

func TestUserStatements_GetUser_UniqueAttributesOnly(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)

		owner := newTestUser(t, projectID, schemaURL, "user_unique_owner", "shared@example.com", "Owner")
		require.NoError(t, d.stmts.CreateUser(t.Context(), owner))

		// A second user carries the same value under the same key, but
		// without a uniqueness scope (e.g. a notification address).
		dupEmail, err := domain.NewCreateAttribute("email", "shared@example.com", domain.AttributeUniquenessUnspecified)
		require.NoError(t, err)
		dup := &domain.CreateUser{
			ProjectID:  projectID,
			SchemaURL:  schemaURL,
			ID:         "user_unique_dup",
			Attributes: []domain.CreateAttribute{*dupEmail},
		}
		require.NoError(t, d.stmts.CreateUser(t.Context(), dup))

		attrs := []domain.Attribute{{Key: "email", Value: "shared@example.com"}}
		projectFilter := database.Equal(database.Col(domain.UserFieldProjectID), projectID)

		_, err = d.stmts.GetUser(t.Context(), projectFilter, service.UserQueryOptions{Attributes: attrs})
		require.Error(t, err, "the plain attribute match sees both users")

		got, err := d.stmts.GetUser(t.Context(), projectFilter, service.UserQueryOptions{
			Attributes:           attrs,
			UniqueAttributesOnly: true,
		})
		require.NoError(t, err)
		assert.Equal(t, owner.ID, got.ID)
	})
}

func TestUserStatements_UniqueAttributes_CaseInsensitive(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)

		owner := newTestUser(t, projectID, schemaURL, "user_case_owner", "Alice@Example.com", "Alice")
		require.NoError(t, d.stmts.CreateUser(t.Context(), owner))

		// The same address in a different casing is the same unique value.
		dup := newTestUser(t, projectID, schemaURL, "user_case_dup", "alice@example.com", "Impostor")
		err := d.stmts.CreateUser(t.Context(), dup)
		var uniqueErr *database.UniqueError
		require.ErrorAs(t, err, &uniqueErr)

		// Resolution matches regardless of the typed casing.
		got, err := d.stmts.GetUser(t.Context(),
			database.Equal(database.Col(domain.UserFieldProjectID), projectID),
			service.UserQueryOptions{
				Attributes:           []domain.Attribute{{Key: "email", Value: "ALICE@EXAMPLE.COM"}},
				UniqueAttributesOnly: true,
			},
		)
		require.NoError(t, err)
		assert.Equal(t, owner.ID, got.ID)
	})
}
