//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"testing"

	"github.com/go-jose/go-jose/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/v2/branding"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func sampleFlowDefinition(projectID, id, name string) *domain.FlowDefinition {
	pivotAction := domain.Pivot
	return &domain.FlowDefinition{
		ProjectID:     projectID,
		ID:            id,
		Name:          name,
		SchemaVersion: "1.0.0",
		Status:        domain.FlowDefinitionStatusDraft,
		UserSchema:    "https://example.com/schemas/human-user.json",
		Purposes: map[domain.FlowDefinitionPurpose]string{
			domain.FlowDefinitionPurposeLogin: "identifier",
		},
		Audience: domain.FlowDefinitionAudience{AppIDs: []string{"app-1"}},
		Steps: []domain.FlowDefinitionStep{{
			Name:   "identifier",
			Fields: []domain.Field{"email"},
			Actions: []domain.FlowStepAction{
				{Name: "submit", Kind: domain.FlowActionKindSubmit, TextKey: "identifier.submit", Primary: true},
			},
			Transitions: map[string]domain.FlowStepTransition{
				"submit":   {Target: "done"},
				"register": {Action: &pivotAction, Target: "register-flow"},
			},
		}},
	}
}

func newTestEncryptionKey(id, projectID string) *domain.EncryptionKey {
	return &domain.EncryptionKey{
		ID:        id,
		ProjectID: projectID,
		Key:       "encrypted-fixture-key",
		Algorithm: jose.A256GCM,
		State:     domain.KeyStateNotActiveYet,
		Purpose:   domain.EncryptionKeyPurposeKEK,
	}
}

// TestCursorBattle_DrainAllListIncarnations covers B1–B3 for every List* path:
// ASC drain, DESC drain, and NextCursor emission.
func TestCursorBattle_DrainAllListIncarnations(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("projects", func(t *testing.T) { battleProjects(t, d) })
		t.Run("teams", func(t *testing.T) { battleTeams(t, d) })
		t.Run("users", func(t *testing.T) { battleUsers(t, d) })
		t.Run("tokens", func(t *testing.T) { battleTokens(t, d) })
		t.Run("sessions", func(t *testing.T) { battleSessions(t, d) })
		t.Run("brandings", func(t *testing.T) { battleBrandings(t, d) })
		t.Run("flow_definitions", func(t *testing.T) { battleFlowDefinitions(t, d) })
		t.Run("json_schemas", func(t *testing.T) { battleJSONSchemas(t, d) })
		t.Run("encryption_keys", func(t *testing.T) { battleEncryptionKeys(t, d) })
		t.Run("team_memberships", func(t *testing.T) { battleTeamMemberships(t, d) })
		t.Run("user_teams", func(t *testing.T) { battleUserTeams(t, d) })
		t.Run("user_passwords", func(t *testing.T) { battleUserPasswords(t, d) })
		t.Run("user_totps", func(t *testing.T) { battleUserTOTPs(t, d) })
		t.Run("user_passkeys", func(t *testing.T) { battleUserPasskeys(t, d) })
		t.Run("user_recovery_codes", func(t *testing.T) { battleUserRecoveryCodes(t, d) })
	})
}

func battleProjects(t *testing.T, d dialect) {
	t.Helper()
	prefix := uniqueProjectID(t)
	want := make([]string, 0, 3)
	for i := range 3 {
		id := prefix + "-" + string(rune('a'+i))
		p := newTestProject(id)
		require.NoError(t, d.stmts.CreateProject(t.Context(), p))
		t.Cleanup(func() { _ = d.stmts.DeleteProjectByID(context.Background(), id) })
		want = append(want, id)
	}
	filter := database.Or(
		database.Equal(database.Col(domain.ProjectFieldID), want[0]),
		database.Equal(database.Col(domain.ProjectFieldID), want[1]),
		database.Equal(database.Col(domain.ProjectFieldID), want[2]),
	)
	orderAsc := database.OrderBy[domain.ProjectField]{
		Columns:   []database.Column[domain.ProjectField]{database.Col(domain.ProjectFieldID)},
		Direction: database.OrderAsc,
	}
	orderDesc := orderAsc
	orderDesc.Direction = database.OrderDesc

	for name, order := range map[string]database.OrderBy[domain.ProjectField]{"asc": orderAsc, "desc": orderDesc} {
		t.Run(name, func(t *testing.T) {
			got := pageAll(t, len(want), nil, func(cursor []byte) (*database.ListResult[*domain.Project], error) {
				return d.stmts.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{
					Filter: filter,
					Pagination: database.Page[domain.ProjectField]{
						Limit:   2,
						OrderBy: order,
						Cursor:  cursor,
					},
				})
			}, func(p *domain.Project) string { return p.ID })
			assertDrainMatch(t, want, got)
		})
	}

	full, err := d.stmts.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{
		Filter:     filter,
		Pagination: database.Page[domain.ProjectField]{Limit: 2, OrderBy: orderAsc},
	})
	require.NoError(t, err)
	short, err := d.stmts.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{
		Filter:     filter,
		Pagination: database.Page[domain.ProjectField]{Limit: 10, OrderBy: orderAsc, Cursor: full.NextCursor},
	})
	require.NoError(t, err)
	assertCursorEmission(t, full, short, 2)
}

func battleTeams(t *testing.T, d dialect) {
	t.Helper()
	projectID := ensureProject(t, d.stmts)
	want := make([]string, 0, 3)
	for range 3 {
		team := newTestTeam(projectID, "")
		require.NoError(t, d.stmts.CreateTeam(t.Context(), team))
		want = append(want, team.ID)
	}
	filter := database.Equal(database.Col(domain.TeamFieldProjectID), projectID)
	orderAsc := database.OrderBy[domain.TeamField]{
		Columns:   []database.Column[domain.TeamField]{database.Col(domain.TeamFieldID)},
		Direction: database.OrderAsc,
	}
	orderDesc := orderAsc
	orderDesc.Direction = database.OrderDesc

	for name, order := range map[string]database.OrderBy[domain.TeamField]{"asc": orderAsc, "desc": orderDesc} {
		t.Run(name, func(t *testing.T) {
			got := pageAll(t, len(want), nil, func(cursor []byte) (*database.ListResult[*domain.Team], error) {
				return d.stmts.ListTeams(t.Context(), &database.ListOptions[domain.TeamField]{
					Filter: filter,
					Pagination: database.Page[domain.TeamField]{
						Limit: 2, OrderBy: order, Cursor: cursor,
					},
				})
			}, func(team *domain.Team) string { return team.ID })
			assertDrainMatch(t, want, got)
		})
	}
}

func battleUsers(t *testing.T, d dialect) {
	t.Helper()
	projectID, schemaURL := ensureUserTestProject(t, d.stmts)
	want := make([]string, 0, 3)
	for i := range 3 {
		id := "usr-battle-" + string(rune('a'+i)) + "-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, id, id+"@example.com", "Battle")))
		t.Cleanup(func() { _ = d.stmts.DeleteUserByID(context.Background(), projectID, id) })
		want = append(want, id)
	}
	filter := database.Equal(database.Col(domain.UserFieldProjectID), projectID)
	orderAsc := database.OrderBy[domain.UserField]{
		Columns:   []database.Column[domain.UserField]{database.Col(domain.UserFieldID)},
		Direction: database.OrderAsc,
	}
	orderDesc := orderAsc
	orderDesc.Direction = database.OrderDesc

	for name, order := range map[string]database.OrderBy[domain.UserField]{"asc": orderAsc, "desc": orderDesc} {
		t.Run(name, func(t *testing.T) {
			got := pageAll(t, len(want), nil, func(cursor []byte) (*database.ListResult[*domain.User], error) {
				return d.stmts.ListUsers(t.Context(), &database.ListOptions[domain.UserField]{
					Filter: filter,
					Pagination: database.Page[domain.UserField]{
						Limit: 2, OrderBy: order, Cursor: cursor,
					},
				}, service.UserQueryOptions{})
			}, func(u *domain.User) string { return u.ID })
			assertDrainMatch(t, want, got)
		})
	}

	// B6: default EnsureListOptions OrderBy still pages.
	t.Run("default_order", func(t *testing.T) {
		got := pageAll(t, len(want), nil, func(cursor []byte) (*database.ListResult[*domain.User], error) {
			return d.stmts.ListUsers(t.Context(), &database.ListOptions[domain.UserField]{
				Filter:     filter,
				Pagination: database.Page[domain.UserField]{Limit: 2, Cursor: cursor},
			}, service.UserQueryOptions{})
		}, func(u *domain.User) string { return u.ID })
		assertDrainMatch(t, want, got)
	})
}

func battleTokens(t *testing.T, d dialect) {
	t.Helper()
	projectID, schemaURL := ensureUserTestProject(t, d.stmts)
	userID := "usr-tok-" + uniqueSuffix(t)
	require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "Tok")))
	t.Cleanup(func() { _ = d.stmts.DeleteUserByID(context.Background(), projectID, userID) })

	want := make([]string, 0, 3)
	for range 3 {
		tok := &domain.Token{
			ProjectID: projectID,
			UserID:    userID,
			Type:      domain.TokenTypePersonalAccessToken,
		}
		require.NoError(t, d.stmts.CreateToken(t.Context(), tok))
		tokenID := tok.TokenID
		t.Cleanup(func() { _ = d.stmts.DeleteTokenByID(context.Background(), projectID, tokenID) })
		want = append(want, tokenID)
	}
	filter := database.And(
		database.Equal(database.Col(domain.TokenFieldProjectID), projectID),
		database.Equal(database.Col(domain.TokenFieldUserID), userID),
	)
	orderAsc := database.OrderBy[domain.TokenField]{
		Columns:   []database.Column[domain.TokenField]{database.Col(domain.TokenFieldTokenID)},
		Direction: database.OrderAsc,
	}
	orderDesc := orderAsc
	orderDesc.Direction = database.OrderDesc

	for name, order := range map[string]database.OrderBy[domain.TokenField]{"asc": orderAsc, "desc": orderDesc} {
		t.Run(name, func(t *testing.T) {
			got := pageAll(t, len(want), nil, func(cursor []byte) (*database.ListResult[*domain.Token], error) {
				return d.stmts.ListTokens(t.Context(), &database.ListOptions[domain.TokenField]{
					Filter: filter,
					Pagination: database.Page[domain.TokenField]{
						Limit: 2, OrderBy: order, Cursor: cursor,
					},
				})
			}, func(tok *domain.Token) string { return tok.TokenID })
			assertDrainMatch(t, want, got)
		})
	}

	// B3b: Tokens without OrderBy emit no NextCursor.
	t.Run("next_cursor_requires_order_by", func(t *testing.T) {
		full, err := d.stmts.ListTokens(t.Context(), &database.ListOptions[domain.TokenField]{
			Filter:     filter,
			Pagination: database.Page[domain.TokenField]{Limit: 2},
		})
		require.NoError(t, err)
		require.Len(t, full.Items, 2)
		assert.Empty(t, full.NextCursor)
	})
}

func battleSessions(t *testing.T, d dialect) {
	t.Helper()
	projectID := ensureProject(t, d.stmts)
	want := make([]string, 0, 3)
	for range 3 {
		want = append(want, createAnonymousSession(t, d.stmts, projectID).ID)
	}
	filter := database.Equal(database.Col(domain.SessionFieldProjectID), projectID)
	orderAsc := database.OrderBy[domain.SessionField]{
		Columns:   []database.Column[domain.SessionField]{database.Col(domain.SessionFieldID)},
		Direction: database.OrderAsc,
	}
	orderDesc := orderAsc
	orderDesc.Direction = database.OrderDesc

	for name, order := range map[string]database.OrderBy[domain.SessionField]{"asc": orderAsc, "desc": orderDesc} {
		t.Run(name, func(t *testing.T) {
			got := pageAll(t, len(want), nil, func(cursor []byte) (*database.ListResult[*domain.Session], error) {
				return d.stmts.ListSessions(t.Context(), &database.ListOptions[domain.SessionField]{
					Filter: filter,
					Pagination: database.Page[domain.SessionField]{
						Limit: 2, OrderBy: order, Cursor: cursor,
					},
				})
			}, func(s *domain.Session) string { return s.ID })
			assertDrainMatch(t, want, got)
		})
	}

	t.Run("default_order_id", func(t *testing.T) {
		got := pageAll(t, len(want), nil, func(cursor []byte) (*database.ListResult[*domain.Session], error) {
			return d.stmts.ListSessions(t.Context(), &database.ListOptions[domain.SessionField]{
				Filter:     filter,
				Pagination: database.Page[domain.SessionField]{Limit: 2, Cursor: cursor},
			})
		}, func(s *domain.Session) string { return s.ID })
		assertDrainMatch(t, want, got)
	})
}

func battleBrandings(t *testing.T, d dialect) {
	t.Helper()
	projectID, _ := uniqueBrandingIDs(t)
	ensureBrandingProject(t, d.stmts, projectID)
	want := make([]string, 0, 3)
	for range 3 {
		entity := sampleBranding(projectID, "")
		require.NoError(t, d.stmts.CreateBranding(t.Context(), entity))
		want = append(want, entity.ID)
	}

	for name, direction := range map[string]database.OrderDirection{
		"asc":  database.OrderAsc,
		"desc": database.OrderDesc,
	} {
		t.Run(name, func(t *testing.T) {
			order := branding.NewestFirst()
			order.Direction = direction
			got := pageAll(t, len(want), nil, func(cursor []byte) (*database.ListResult[*domain.Branding], error) {
				return d.stmts.ListBrandings(t.Context(), &database.ListOptions[domain.BrandingField]{
					Filter: database.Equal(database.Col(domain.BrandingFieldProjectID), projectID),
					Pagination: database.Page[domain.BrandingField]{
						Limit: 2, OrderBy: order, Cursor: cursor,
					},
				})
			}, func(b *domain.Branding) string { return b.ID })
			assertDrainMatch(t, want, got)
		})
	}

	t.Run("newest_first_helper", func(t *testing.T) {
		got := pageAll(t, len(want), nil, func(cursor []byte) (*database.ListResult[*domain.Branding], error) {
			opts := branding.ListOptions(projectID, 2)
			opts.Pagination.Cursor = cursor
			return d.stmts.ListBrandings(t.Context(), opts)
		}, func(b *domain.Branding) string { return b.ID })
		assertDrainMatch(t, want, got)
	})
}

func battleFlowDefinitions(t *testing.T, d dialect) {
	t.Helper()
	projectID := ensureProject(t, d.stmts)
	want := make([]string, 0, 3)
	for i := range 3 {
		id := "flow-" + uniqueSuffix(t) + "-" + string(rune('a'+i))
		def := sampleFlowDefinition(projectID, id, "Flow "+string(rune('A'+i)))
		require.NoError(t, d.stmts.CreateFlowDefinition(t.Context(), def))
		t.Cleanup(func() { _ = d.stmts.DeleteFlowDefinitionByID(context.Background(), projectID, id) })
		want = append(want, id)
	}
	filter := database.Equal(database.Col(domain.FlowDefinitionFieldProjectID), projectID)

	t.Run("default_order", func(t *testing.T) {
		got := pageAll(t, len(want), nil, func(cursor []byte) (*database.ListResult[*domain.FlowDefinition], error) {
			return d.stmts.ListFlowDefinitions(t.Context(), &database.ListOptions[domain.FlowDefinitionField]{
				Filter:     filter,
				Pagination: database.Page[domain.FlowDefinitionField]{Limit: 2, Cursor: cursor},
			})
		}, func(def *domain.FlowDefinition) string { return def.ID })
		assertDrainMatch(t, want, got)
	})

	orderAsc := database.OrderBy[domain.FlowDefinitionField]{
		Columns: []database.Column[domain.FlowDefinitionField]{
			database.Col(domain.FlowDefinitionFieldID),
		},
		Direction: database.OrderAsc,
	}
	orderDesc := orderAsc
	orderDesc.Direction = database.OrderDesc
	for name, order := range map[string]database.OrderBy[domain.FlowDefinitionField]{"asc": orderAsc, "desc": orderDesc} {
		t.Run(name, func(t *testing.T) {
			got := pageAll(t, len(want), nil, func(cursor []byte) (*database.ListResult[*domain.FlowDefinition], error) {
				return d.stmts.ListFlowDefinitions(t.Context(), &database.ListOptions[domain.FlowDefinitionField]{
					Filter: filter,
					Pagination: database.Page[domain.FlowDefinitionField]{
						Limit: 2, OrderBy: order, Cursor: cursor,
					},
				})
			}, func(def *domain.FlowDefinition) string { return def.ID })
			assertDrainMatch(t, want, got)
		})
	}
}

func battleJSONSchemas(t *testing.T, d dialect) {
	t.Helper()
	projectID := ensureProject(t, d.stmts)
	want := make([]string, 0, 3)
	for i := range 3 {
		url := "https://example.com/schemas/battle-" + uniqueSuffix(t) + "-" + string(rune('a'+i))
		require.NoError(t, d.stmts.CreateJSONSchema(t.Context(), &domain.JSONSchema{
			ProjectID: projectID,
			URL:       url,
			Schema:    []byte(`{"type":"object"}`),
		}))
		t.Cleanup(func() { _ = d.stmts.DeleteJSONSchemaByID(context.Background(), projectID, url) })
		want = append(want, url)
	}
	filter := database.Equal(database.Col(domain.JSONSchemaFieldProjectID), projectID)
	orderAsc := database.OrderBy[domain.JSONSchemaField]{
		Columns:   []database.Column[domain.JSONSchemaField]{database.Col(domain.JSONSchemaFieldURL)},
		Direction: database.OrderAsc,
	}
	orderDesc := orderAsc
	orderDesc.Direction = database.OrderDesc

	for name, order := range map[string]database.OrderBy[domain.JSONSchemaField]{"asc": orderAsc, "desc": orderDesc} {
		t.Run(name, func(t *testing.T) {
			got := pageAll(t, len(want), nil, func(cursor []byte) (*database.ListResult[*domain.JSONSchema], error) {
				return d.stmts.ListJSONSchemas(t.Context(), &database.ListOptions[domain.JSONSchemaField]{
					Filter: filter,
					Pagination: database.Page[domain.JSONSchemaField]{
						Limit: 2, OrderBy: order, Cursor: cursor,
					},
				})
			}, func(s *domain.JSONSchema) string { return s.URL })
			assertDrainMatch(t, want, got)
		})
	}
}

func battleEncryptionKeys(t *testing.T, d dialect) {
	t.Helper()
	projectID := ensureProject(t, d.stmts)
	want := make([]string, 0, 3)
	for range 3 {
		key := newTestEncryptionKey("", projectID)
		require.NoError(t, d.stmts.CreateEncryptionKey(t.Context(), key))
		want = append(want, key.ID)
	}
	filter := database.Equal(database.Col(domain.EncryptionKeyFieldProjectID), projectID)
	orderAsc := database.OrderBy[domain.EncryptionKeyField]{
		Columns:   []database.Column[domain.EncryptionKeyField]{database.Col(domain.EncryptionKeyFieldID)},
		Direction: database.OrderAsc,
	}
	orderDesc := orderAsc
	orderDesc.Direction = database.OrderDesc

	for name, order := range map[string]database.OrderBy[domain.EncryptionKeyField]{"asc": orderAsc, "desc": orderDesc} {
		t.Run(name, func(t *testing.T) {
			got := pageAll(t, len(want), nil, func(cursor []byte) (*database.ListResult[*domain.EncryptionKey], error) {
				return d.stmts.ListEncryptionKeys(t.Context(), &database.ListOptions[domain.EncryptionKeyField]{
					Filter: filter,
					Pagination: database.Page[domain.EncryptionKeyField]{
						Limit: 2, OrderBy: order, Cursor: cursor,
					},
				})
			}, func(k *domain.EncryptionKey) string { return k.ID })
			assertDrainMatch(t, want, got)
		})
	}
}

func battleTeamMemberships(t *testing.T, d dialect) {
	t.Helper()
	projectID, schemaURL := ensureUserTestProject(t, d.stmts)
	team := newTestTeam(projectID, "")
	require.NoError(t, d.stmts.CreateTeam(t.Context(), team))

	want := make([]string, 0, 3)
	for i := range 3 {
		userID := "usr-mem-" + string(rune('a'+i)) + "-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "Mem")))
		t.Cleanup(func() { _ = d.stmts.DeleteUserByID(context.Background(), projectID, userID) })
		require.NoError(t, d.stmts.CreateTeamMembership(t.Context(), &domain.TeamMembership{
			ProjectID: projectID,
			TeamID:    team.ID,
			UserID:    userID,
			Status:    domain.MembershipStatusActive,
		}))
		want = append(want, userID)
	}
	filter := database.And(
		database.Equal(database.Col(domain.TeamMembershipFieldProjectID), projectID),
		database.Equal(database.Col(domain.TeamMembershipFieldTeamID), team.ID),
	)
	orderAsc := database.OrderBy[domain.TeamMembershipField]{
		Columns:   []database.Column[domain.TeamMembershipField]{database.Col(domain.TeamMembershipFieldUserID)},
		Direction: database.OrderAsc,
	}
	orderDesc := orderAsc
	orderDesc.Direction = database.OrderDesc

	for name, order := range map[string]database.OrderBy[domain.TeamMembershipField]{"asc": orderAsc, "desc": orderDesc} {
		t.Run(name, func(t *testing.T) {
			got := pageAll(t, len(want), nil, func(cursor []byte) (*database.ListResult[*domain.TeamMembership], error) {
				return d.stmts.ListTeamMemberships(t.Context(), &database.ListOptions[domain.TeamMembershipField]{
					Filter: filter,
					Pagination: database.Page[domain.TeamMembershipField]{
						Limit: 2, OrderBy: order, Cursor: cursor,
					},
				})
			}, func(m *domain.TeamMembership) string { return m.UserID })
			assertDrainMatch(t, want, got)
		})
	}
}

func battleUserTeams(t *testing.T, d dialect) {
	t.Helper()
	projectID, schemaURL := ensureUserTestProject(t, d.stmts)
	userID := "usr-teams-" + uniqueSuffix(t)
	require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "Teams")))
	t.Cleanup(func() { _ = d.stmts.DeleteUserByID(context.Background(), projectID, userID) })

	want := make([]string, 0, 3)
	for range 3 {
		team := newTestTeam(projectID, "")
		require.NoError(t, d.stmts.CreateTeam(t.Context(), team))
		require.NoError(t, d.stmts.CreateTeamMembership(t.Context(), &domain.TeamMembership{
			ProjectID: projectID,
			TeamID:    team.ID,
			UserID:    userID,
			Status:    domain.MembershipStatusActive,
		}))
		want = append(want, team.ID)
	}
	filter := database.And(
		database.Equal(database.Col(domain.UserTeamFieldProjectID), projectID),
		database.Equal(database.Col(domain.UserTeamFieldUserID), userID),
	)
	orderAsc := database.OrderBy[domain.UserTeamField]{
		Columns:   []database.Column[domain.UserTeamField]{database.Col(domain.UserTeamFieldTeamID)},
		Direction: database.OrderAsc,
	}
	orderDesc := orderAsc
	orderDesc.Direction = database.OrderDesc

	for name, order := range map[string]database.OrderBy[domain.UserTeamField]{"asc": orderAsc, "desc": orderDesc} {
		t.Run(name, func(t *testing.T) {
			got := pageAll(t, len(want), nil, func(cursor []byte) (*database.ListResult[*domain.UserTeam], error) {
				return d.stmts.ListUserTeams(t.Context(), &database.ListOptions[domain.UserTeamField]{
					Filter: filter,
					Pagination: database.Page[domain.UserTeamField]{
						Limit: 2, OrderBy: order, Cursor: cursor,
					},
				})
			}, func(ut *domain.UserTeam) string { return ut.TeamID })
			assertDrainMatch(t, want, got)
		})
	}
}

func battleUserPasswords(t *testing.T, d dialect) {
	t.Helper()
	projectID, schemaURL := ensureUserTestProject(t, d.stmts)
	want := make([]string, 0, 3)
	for i := range 3 {
		userID := "usr-pw-" + string(rune('a'+i)) + "-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "PW")))
		t.Cleanup(func() { _ = d.stmts.DeleteUserByID(context.Background(), projectID, userID) })
		require.NoError(t, d.stmts.SetUserPassword(t.Context(), &domain.SetUserPassword{
			ProjectID:   projectID,
			UserID:      userID,
			EncodedHash: "argon2id$v=19$m=65536,t=3,p=4$fixture",
		}))
		listed, err := d.stmts.ListUserPasswords(t.Context(), &database.ListOptions[domain.UserPasswordField]{
			Filter: database.And(
				database.Equal(database.Col(domain.UserPasswordFieldProjectID), projectID),
				database.Equal(database.Col(domain.UserPasswordFieldUserID), userID),
			),
		})
		require.NoError(t, err)
		require.Len(t, listed.Items, 1)
		want = append(want, listed.Items[0].ID)
	}
	filter := database.Equal(database.Col(domain.UserPasswordFieldProjectID), projectID)
	orderAsc := database.OrderBy[domain.UserPasswordField]{
		Columns:   []database.Column[domain.UserPasswordField]{database.Col(domain.UserPasswordFieldID)},
		Direction: database.OrderAsc,
	}
	orderDesc := orderAsc
	orderDesc.Direction = database.OrderDesc

	for name, order := range map[string]database.OrderBy[domain.UserPasswordField]{"asc": orderAsc, "desc": orderDesc} {
		t.Run(name, func(t *testing.T) {
			got := pageAll(t, len(want), nil, func(cursor []byte) (*database.ListResult[*domain.UserPassword], error) {
				return d.stmts.ListUserPasswords(t.Context(), &database.ListOptions[domain.UserPasswordField]{
					Filter: filter,
					Pagination: database.Page[domain.UserPasswordField]{
						Limit: 2, OrderBy: order, Cursor: cursor,
					},
				})
			}, func(p *domain.UserPassword) string { return p.ID })
			assertDrainMatch(t, want, got)
		})
	}
}

func battleUserTOTPs(t *testing.T, d dialect) {
	t.Helper()
	projectID, schemaURL := ensureUserTestProject(t, d.stmts)
	want := make([]string, 0, 3)
	for i := range 3 {
		userID := "usr-totp-" + string(rune('a'+i)) + "-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "TOTP")))
		t.Cleanup(func() { _ = d.stmts.DeleteUserByID(context.Background(), projectID, userID) })
		require.NoError(t, d.stmts.CreateUserTOTP(t.Context(), &domain.CreateUserTOTP{
			ProjectID: projectID,
			UserID:    userID,
			Secret:    []byte("secret-" + userID),
		}))
		listed, err := d.stmts.ListUserTOTPs(t.Context(), &database.ListOptions[domain.UserTOTPField]{
			Filter: database.And(
				database.Equal(database.Col(domain.UserTOTPFieldProjectID), projectID),
				database.Equal(database.Col(domain.UserTOTPFieldUserID), userID),
			),
		})
		require.NoError(t, err)
		require.Len(t, listed.Items, 1)
		want = append(want, listed.Items[0].ID)
	}
	filter := database.Equal(database.Col(domain.UserTOTPFieldProjectID), projectID)
	orderAsc := database.OrderBy[domain.UserTOTPField]{
		Columns:   []database.Column[domain.UserTOTPField]{database.Col(domain.UserTOTPFieldID)},
		Direction: database.OrderAsc,
	}
	orderDesc := orderAsc
	orderDesc.Direction = database.OrderDesc

	for name, order := range map[string]database.OrderBy[domain.UserTOTPField]{"asc": orderAsc, "desc": orderDesc} {
		t.Run(name, func(t *testing.T) {
			got := pageAll(t, len(want), nil, func(cursor []byte) (*database.ListResult[*domain.UserTOTP], error) {
				return d.stmts.ListUserTOTPs(t.Context(), &database.ListOptions[domain.UserTOTPField]{
					Filter: filter,
					Pagination: database.Page[domain.UserTOTPField]{
						Limit: 2, OrderBy: order, Cursor: cursor,
					},
				})
			}, func(item *domain.UserTOTP) string { return item.ID })
			assertDrainMatch(t, want, got)
		})
	}
}

func battleUserPasskeys(t *testing.T, d dialect) {
	t.Helper()
	projectID, schemaURL := ensureUserTestProject(t, d.stmts)
	userID := "usr-pk-" + uniqueSuffix(t)
	require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "PK")))
	t.Cleanup(func() { _ = d.stmts.DeleteUserByID(context.Background(), projectID, userID) })

	want := make([]string, 0, 3)
	for i := range 3 {
		credID := "cred-" + string(rune('a'+i)) + "-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateUserPasskey(t.Context(), &domain.CreateUserPasskey{
			ProjectID:    projectID,
			UserID:       userID,
			CredentialID: credID,
			PublicKey:    []byte{1, 2, 3, byte(i)},
			AAGUID:       []byte{0x0a, 0x0b},
			Name:         "key-" + string(rune('a'+i)),
		}))
		listed, err := d.stmts.ListUserPasskeys(t.Context(), &database.ListOptions[domain.UserPasskeyField]{
			Filter: database.And(
				database.Equal(database.Col(domain.UserPasskeyFieldProjectID), projectID),
				database.Equal(database.Col(domain.UserPasskeyFieldCredentialID), credID),
			),
		})
		require.NoError(t, err)
		require.Len(t, listed.Items, 1)
		want = append(want, listed.Items[0].ID)
	}
	filter := database.And(
		database.Equal(database.Col(domain.UserPasskeyFieldProjectID), projectID),
		database.Equal(database.Col(domain.UserPasskeyFieldUserID), userID),
	)
	orderAsc := database.OrderBy[domain.UserPasskeyField]{
		Columns:   []database.Column[domain.UserPasskeyField]{database.Col(domain.UserPasskeyFieldID)},
		Direction: database.OrderAsc,
	}
	orderDesc := orderAsc
	orderDesc.Direction = database.OrderDesc

	for name, order := range map[string]database.OrderBy[domain.UserPasskeyField]{"asc": orderAsc, "desc": orderDesc} {
		t.Run(name, func(t *testing.T) {
			got := pageAll(t, len(want), nil, func(cursor []byte) (*database.ListResult[*domain.UserPasskey], error) {
				return d.stmts.ListUserPasskeys(t.Context(), &database.ListOptions[domain.UserPasskeyField]{
					Filter: filter,
					Pagination: database.Page[domain.UserPasskeyField]{
						Limit: 2, OrderBy: order, Cursor: cursor,
					},
				})
			}, func(item *domain.UserPasskey) string { return item.ID })
			assertDrainMatch(t, want, got)
		})
	}
}

func battleUserRecoveryCodes(t *testing.T, d dialect) {
	t.Helper()
	projectID, schemaURL := ensureUserTestProject(t, d.stmts)
	want := make([]string, 0, 3)
	for i := range 3 {
		userID := "usr-rc-" + string(rune('a'+i)) + "-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "RC")))
		t.Cleanup(func() { _ = d.stmts.DeleteUserByID(context.Background(), projectID, userID) })
		require.NoError(t, d.stmts.CreateUserRecoveryCodes(t.Context(), &domain.CreateRecoveryCodes{
			ProjectID:     projectID,
			UserID:        userID,
			RecoveryCodes: []string{"aaaa-bbbb-cccc-" + string(rune('a'+i))},
		}))
		listed, err := d.stmts.ListUserRecoveryCodes(t.Context(), &database.ListOptions[domain.UserRecoveryCodesField]{
			Filter: database.And(
				database.Equal(database.Col(domain.UserRecoveryCodesFieldProjectID), projectID),
				database.Equal(database.Col(domain.UserRecoveryCodesFieldUserID), userID),
			),
		})
		require.NoError(t, err)
		require.Len(t, listed.Items, 1)
		want = append(want, listed.Items[0].ID)
	}
	filter := database.Equal(database.Col(domain.UserRecoveryCodesFieldProjectID), projectID)
	orderAsc := database.OrderBy[domain.UserRecoveryCodesField]{
		Columns:   []database.Column[domain.UserRecoveryCodesField]{database.Col(domain.UserRecoveryCodesFieldID)},
		Direction: database.OrderAsc,
	}
	orderDesc := orderAsc
	orderDesc.Direction = database.OrderDesc

	for name, order := range map[string]database.OrderBy[domain.UserRecoveryCodesField]{"asc": orderAsc, "desc": orderDesc} {
		t.Run(name, func(t *testing.T) {
			got := pageAll(t, len(want), nil, func(cursor []byte) (*database.ListResult[*domain.UserRecoveryCodes], error) {
				return d.stmts.ListUserRecoveryCodes(t.Context(), &database.ListOptions[domain.UserRecoveryCodesField]{
					Filter: filter,
					Pagination: database.Page[domain.UserRecoveryCodesField]{
						Limit: 2, OrderBy: order, Cursor: cursor,
					},
				})
			}, func(item *domain.UserRecoveryCodes) string { return item.ID })
			assertDrainMatch(t, want, got)
		})
	}
}
