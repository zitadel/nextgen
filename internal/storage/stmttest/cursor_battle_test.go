//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"maps"
	"slices"
	"strings"
	"testing"

	"github.com/go-jose/go-jose/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/branding"
	"github.com/zitadel/nextgen/internal/storage/database"
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
// ASC drain, DESC drain, and NextCursor emission via drainIncarnation.
func TestCursorBattle_DrainAllListIncarnations(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("projects", func(t *testing.T) { battleProjects(t, d) })
		t.Run("teams", func(t *testing.T) { battleTeams(t, d) })
		t.Run("users", func(t *testing.T) { battleUsers(t, d) })
		t.Run("tokens", func(t *testing.T) { battleTokens(t, d) })
		t.Run("sessions", func(t *testing.T) { battleSessions(t, d) })
		t.Run("brandings", func(t *testing.T) { battleBrandings(t, d) })
		t.Run("environments", func(t *testing.T) { battleEnvironments(t, d) })
		t.Run("flow_definitions", func(t *testing.T) { battleFlowDefinitions(t, d) })
		t.Run("json_schemas", func(t *testing.T) { battleJSONSchemas(t, d) })
		t.Run("json_schemas_latest", func(t *testing.T) { battleJSONSchemasLatest(t, d) })
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
	want := make([]string, 0, 5)
	for i := range 5 {
		id := prefix + "-" + string(rune('a'+i))
		p := newTestProject(id)
		require.NoError(t, d.stmts.CreateProject(t.Context(), p))
		t.Cleanup(func() { _, _ = d.stmts.DeleteProjectByID(context.Background(), id) })
		want = append(want, id)
	}
	filters := make([]database.Filter[domain.ProjectField], 0, len(want))
	for _, id := range want {
		filters = append(filters, database.Equal(database.Col(domain.ProjectFieldID), id))
	}
	filter := database.Or(filters...)
	orderAsc := database.OrderBy[domain.ProjectField]{
		Columns:   []database.Column[domain.ProjectField]{database.Col(domain.ProjectFieldID)},
		Direction: database.OrderAsc,
	}
	slices.Sort(want)
	drainIncarnation(t, want, orderAsc, func(page database.Page[domain.ProjectField]) (*database.ListResult[*domain.Project], error) {
		return d.stmts.ListProjects(t.Context(), &database.ListOptions[domain.ProjectField]{
			Filter: filter, Pagination: page,
		})
	}, func(p *domain.Project) string { return p.ID }, 2)
}

func battleTeams(t *testing.T, d dialect) {
	t.Helper()
	projectID := ensureProject(t, d.stmts)
	want := make([]string, 0, 5)
	for range 5 {
		team := newTestTeam(projectID, "")
		require.NoError(t, d.stmts.CreateTeam(t.Context(), team))
		want = append(want, team.ID)
	}
	filter := database.Equal(database.Col(domain.TeamFieldProjectID), projectID)
	orderAsc := database.OrderBy[domain.TeamField]{
		Columns:   []database.Column[domain.TeamField]{database.Col(domain.TeamFieldID)},
		Direction: database.OrderAsc,
	}
	slices.Sort(want)
	drainIncarnation(t, want, orderAsc, func(page database.Page[domain.TeamField]) (*database.ListResult[*domain.Team], error) {
		return d.stmts.ListTeams(unfilteredListCtx(t), &database.ListOptions[domain.TeamField]{
			Filter: filter, Pagination: page,
		})
	}, func(team *domain.Team) string { return team.ID }, 2)
}

func battleUsers(t *testing.T, d dialect) {
	t.Helper()
	projectID, schemaURL := ensureUserTestProject(t, d.stmts)
	want := make([]string, 0, 5)
	for i := range 5 {
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
	slices.Sort(want)
	drainIncarnation(t, want, orderAsc, func(page database.Page[domain.UserField]) (*database.ListResult[*domain.User], error) {
		return d.stmts.ListUsers(unfilteredListCtx(t), &database.ListOptions[domain.UserField]{
			Filter: filter, Pagination: page,
		}, service.UserQueryOptions{})
	}, func(u *domain.User) string { return u.ID }, 2)

	// B6: default EnsureListOptions OrderBy still pages.
	t.Run("default_order", func(t *testing.T) {
		got := pageAll(t, len(want), nil, func(cursor []byte) (*database.ListResult[*domain.User], error) {
			return d.stmts.ListUsers(unfilteredListCtx(t), &database.ListOptions[domain.UserField]{
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

	want := make([]string, 0, 5)
	for range 5 {
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
	slices.Sort(want)
	drainIncarnation(t, want, orderAsc, func(page database.Page[domain.TokenField]) (*database.ListResult[*domain.Token], error) {
		return d.stmts.ListTokens(t.Context(), &database.ListOptions[domain.TokenField]{
			Filter: filter, Pagination: page,
		})
	}, func(tok *domain.Token) string { return tok.TokenID }, 2)

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
	want := make([]string, 0, 5)
	for range 5 {
		want = append(want, createAnonymousSession(t, d.stmts, projectID).ID)
	}
	filter := database.Equal(database.Col(domain.SessionFieldProjectID), projectID)
	orderAsc := database.OrderBy[domain.SessionField]{
		Columns:   []database.Column[domain.SessionField]{database.Col(domain.SessionFieldID)},
		Direction: database.OrderAsc,
	}
	slices.Sort(want)
	drainIncarnation(t, want, orderAsc, func(page database.Page[domain.SessionField]) (*database.ListResult[*domain.Session], error) {
		return d.stmts.ListSessions(t.Context(), &database.ListOptions[domain.SessionField]{
			Filter: filter, Pagination: page,
		})
	}, func(s *domain.Session) string { return s.ID }, 2)

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
	want := make([]string, 0, 5)
	for range 5 {
		entity := sampleBranding(projectID, "")
		require.NoError(t, d.stmts.CreateBranding(t.Context(), entity))
		want = append(want, entity.ID)
	}
	filter := database.Equal(database.Col(domain.BrandingFieldProjectID), projectID)
	orderAsc := branding.NewestFirst()
	orderAsc.Direction = database.OrderAsc
	drainIncarnation(t, want, orderAsc, func(page database.Page[domain.BrandingField]) (*database.ListResult[*domain.Branding], error) {
		return d.stmts.ListBrandings(unfilteredListCtx(t), &database.ListOptions[domain.BrandingField]{
			Filter: filter, Pagination: page,
		})
	}, func(b *domain.Branding) string { return b.ID }, 2)

	t.Run("newest_first_helper", func(t *testing.T) {
		got := pageAll(t, len(want), nil, func(cursor []byte) (*database.ListResult[*domain.Branding], error) {
			opts := branding.ListOptions(projectID, 2)
			opts.Pagination.Cursor = cursor
			return d.stmts.ListBrandings(unfilteredListCtx(t), opts)
		}, func(b *domain.Branding) string { return b.ID })
		assertDrainMatch(t, want, got)
	})
}

func battleEnvironments(t *testing.T, d dialect) {
	t.Helper()
	projectID := ensureEnvironmentProject(t, d.stmts)
	// Five names, not the three seeded ones: drainIncarnation needs more rows
	// than the emission limit so the last page is short. Created out of order
	// and collected in name order, because that is the order the list returns.
	names := []string{"staging", "dev", "sandbox", "prod", "preview"}
	byName := make(map[string]string, len(names))
	for _, name := range names {
		byName[name] = createEnvironment(t, d.stmts, projectID, name).ID
	}
	want := make([]string, 0, len(names))
	for _, name := range slices.Sorted(maps.Keys(byName)) {
		want = append(want, byName[name])
	}
	filter := database.Equal(database.Col(domain.EnvironmentFieldProjectID), projectID)
	orderAsc := database.OrderBy[domain.EnvironmentField]{
		Columns:   []database.Column[domain.EnvironmentField]{database.Col(domain.EnvironmentFieldName)},
		Direction: database.OrderAsc,
	}
	drainIncarnation(t, want, orderAsc, func(page database.Page[domain.EnvironmentField]) (*database.ListResult[*domain.Environment], error) {
		return d.stmts.ListEnvironments(unfilteredListCtx(t), &database.ListOptions[domain.EnvironmentField]{
			Filter: filter, Pagination: page,
		})
	}, func(e *domain.Environment) string { return e.ID }, 2)

	t.Run("name_order_helper", func(t *testing.T) {
		got := pageAll(t, len(want), nil, func(cursor []byte) (*database.ListResult[*domain.Environment], error) {
			return d.stmts.ListEnvironments(unfilteredListCtx(t), &database.ListOptions[domain.EnvironmentField]{
				Filter: database.Equal(database.Col(domain.EnvironmentFieldProjectID), projectID),
				Pagination: database.Page[domain.EnvironmentField]{
					Limit:  2,
					Cursor: cursor,
					OrderBy: database.OrderBy[domain.EnvironmentField]{
						Columns: []database.Column[domain.EnvironmentField]{
							database.Col(domain.EnvironmentFieldName),
						},
						Direction: database.OrderAsc,
					},
				},
			})
		}, func(e *domain.Environment) string { return e.ID })
		assertDrainMatch(t, want, got)
	})
}

func battleFlowDefinitions(t *testing.T, d dialect) {
	t.Helper()
	projectID := ensureProject(t, d.stmts)
	want := make([]string, 0, 5)
	for i := range 5 {
		id := "flow-" + uniqueSuffix(t) + "-" + string(rune('a'+i))
		def := sampleFlowDefinition(projectID, id, "Flow "+string(rune('A'+i)))
		require.NoError(t, d.stmts.CreateFlowDefinition(t.Context(), def))
		t.Cleanup(func() { _ = d.stmts.DeleteFlowDefinitionByID(context.Background(), projectID, id) })
		want = append(want, id)
	}
	filter := database.Equal(database.Col(domain.FlowDefinitionFieldProjectID), projectID)
	orderAsc := database.OrderBy[domain.FlowDefinitionField]{
		Columns:   []database.Column[domain.FlowDefinitionField]{database.Col(domain.FlowDefinitionFieldID)},
		Direction: database.OrderAsc,
	}
	slices.Sort(want)
	drainIncarnation(t, want, orderAsc, func(page database.Page[domain.FlowDefinitionField]) (*database.ListResult[*domain.FlowDefinition], error) {
		return d.stmts.ListFlowDefinitions(unfilteredListCtx(t), &database.ListOptions[domain.FlowDefinitionField]{
			Filter: filter, Pagination: page,
		})
	}, func(def *domain.FlowDefinition) string { return def.ID }, 2)

	t.Run("default_order", func(t *testing.T) {
		got := pageAll(t, len(want), nil, func(cursor []byte) (*database.ListResult[*domain.FlowDefinition], error) {
			return d.stmts.ListFlowDefinitions(unfilteredListCtx(t), &database.ListOptions[domain.FlowDefinitionField]{
				Filter:     filter,
				Pagination: database.Page[domain.FlowDefinitionField]{Limit: 2, Cursor: cursor},
			})
		}, func(def *domain.FlowDefinition) string { return def.ID })
		assertDrainMatch(t, want, got)
	})
}

func battleJSONSchemas(t *testing.T, d dialect) {
	t.Helper()
	projectID := ensureProject(t, d.stmts)
	created := make([]*domain.JSONSchema, 0, 5)
	want := make([]string, 0, 5)
	for i := range 5 {
		schema := &domain.JSONSchema{
			ProjectID: projectID,
			URL:       "https://example.com/schemas/battle-" + uniqueSuffix(t) + "-" + string(rune('a'+i)),
			Schema:    []byte(`{"type":"object"}`),
		}
		require.NoError(t, d.stmts.CreateJSONSchema(t.Context(), schema))
		url := schema.URL
		t.Cleanup(func() { _ = d.stmts.DeleteJSONSchemaByID(context.Background(), projectID, url) })
		created = append(created, schema)
		want = append(want, url)
	}
	filter := database.Equal(database.Col(domain.JSONSchemaFieldProjectID), projectID)
	orderAsc := database.OrderBy[domain.JSONSchemaField]{
		Columns:   []database.Column[domain.JSONSchemaField]{database.Col(domain.JSONSchemaFieldURL)},
		Direction: database.OrderAsc,
	}
	slices.Sort(want)
	drainIncarnation(t, want, orderAsc, func(page database.Page[domain.JSONSchemaField]) (*database.ListResult[*domain.JSONSchema], error) {
		return d.stmts.ListJSONSchemas(unfilteredListCtx(t), &database.ListOptions[domain.JSONSchemaField]{
			Filter: filter, Pagination: page,
		}, service.JSONSchemaQueryOptions{})
	}, func(s *domain.JSONSchema) string { return s.URL }, 2)

	// SchemaService.ListSchemas pages by (created_at, url); url breaks
	// created_at ties. Expected order comes from the timestamps the dialect
	// scanned back at insert, so it holds whether or not they collide (the
	// generic tie-at-the-boundary property is runListCursorTie's).
	t.Run("created_at_url_order", func(t *testing.T) {
		byCreated := slices.Clone(created)
		slices.SortFunc(byCreated, func(a, b *domain.JSONSchema) int {
			if c := a.CreatedAt.Compare(b.CreatedAt); c != 0 {
				return c
			}
			return strings.Compare(a.URL, b.URL)
		})
		wantByCreated := make([]string, 0, len(byCreated))
		for _, schema := range byCreated {
			wantByCreated = append(wantByCreated, schema.URL)
		}
		orderCreatedAsc := database.OrderBy[domain.JSONSchemaField]{
			Columns: []database.Column[domain.JSONSchemaField]{
				database.Col(domain.JSONSchemaFieldCreatedAt),
				database.Col(domain.JSONSchemaFieldURL),
			},
			Direction: database.OrderAsc,
		}
		drainIncarnation(t, wantByCreated, orderCreatedAsc, func(page database.Page[domain.JSONSchemaField]) (*database.ListResult[*domain.JSONSchema], error) {
			return d.stmts.ListJSONSchemas(unfilteredListCtx(t), &database.ListOptions[domain.JSONSchemaField]{
				Filter: filter, Pagination: page,
			}, service.JSONSchemaQueryOptions{})
		}, func(s *domain.JSONSchema) string { return s.URL }, 2)
	})
}

// battleJSONSchemasLatest is the load-bearing case for #923: latest mode adds a
// correlated anti-join to the same WHERE the keyset predicate lives in, so a
// page boundary is where the two would fall out of step. Every object type here
// has a superseded revision, so a drain that returns one of them — or drops a
// current one — is a broken composition, not a slow test.
func battleJSONSchemasLatest(t *testing.T, d dialect) {
	t.Helper()
	projectID := ensureProject(t, d.stmts)
	suffix := uniqueSuffix(t)
	want := make([]string, 0, 5)
	for i := range 5 {
		objectType := "battle-latest-" + suffix + "-" + string(rune('a'+i))
		var latestURL string
		for _, revision := range []string{"-v1", "-v2"} {
			schema := &domain.JSONSchema{
				ProjectID:  projectID,
				URL:        "https://example.com/schemas/" + objectType + revision,
				ObjectType: &objectType,
				Schema:     []byte(`{"type":"object"}`),
			}
			require.NoError(t, d.stmts.CreateJSONSchema(t.Context(), schema))
			url := schema.URL
			t.Cleanup(func() { _ = d.stmts.DeleteJSONSchemaByID(context.Background(), projectID, url) })
			latestURL = url
		}
		want = append(want, latestURL)
	}
	filter := database.Equal(database.Col(domain.JSONSchemaFieldProjectID), projectID)
	orderAsc := database.OrderBy[domain.JSONSchemaField]{
		Columns: []database.Column[domain.JSONSchemaField]{
			database.Col(domain.JSONSchemaFieldCreatedAt),
			database.Col(domain.JSONSchemaFieldURL),
		},
		Direction: database.OrderAsc,
	}
	// Seeded oldest first within an object type and object type by object type,
	// so the surviving revisions are already in created_at order.
	drainIncarnation(t, want, orderAsc, func(page database.Page[domain.JSONSchemaField]) (*database.ListResult[*domain.JSONSchema], error) {
		return d.stmts.ListJSONSchemas(unfilteredListCtx(t), &database.ListOptions[domain.JSONSchemaField]{
			Filter: filter, Pagination: page,
		}, service.JSONSchemaQueryOptions{LatestRevisionPerObjectType: true})
	}, func(s *domain.JSONSchema) string { return s.URL }, 2)
}

func battleEncryptionKeys(t *testing.T, d dialect) {
	t.Helper()
	projectID := ensureProject(t, d.stmts)
	want := make([]string, 0, 5)
	for range 5 {
		key := newTestEncryptionKey("", projectID)
		require.NoError(t, d.stmts.CreateEncryptionKey(t.Context(), key))
		want = append(want, key.ID)
	}
	filter := database.Equal(database.Col(domain.EncryptionKeyFieldProjectID), projectID)
	orderAsc := database.OrderBy[domain.EncryptionKeyField]{
		Columns:   []database.Column[domain.EncryptionKeyField]{database.Col(domain.EncryptionKeyFieldID)},
		Direction: database.OrderAsc,
	}
	slices.Sort(want)
	drainIncarnation(t, want, orderAsc, func(page database.Page[domain.EncryptionKeyField]) (*database.ListResult[*domain.EncryptionKey], error) {
		return d.stmts.ListEncryptionKeys(t.Context(), &database.ListOptions[domain.EncryptionKeyField]{
			Filter: filter, Pagination: page,
		})
	}, func(k *domain.EncryptionKey) string { return k.ID }, 2)
}

func battleTeamMemberships(t *testing.T, d dialect) {
	t.Helper()
	projectID, schemaURL := ensureUserTestProject(t, d.stmts)
	team := newTestTeam(projectID, "")
	require.NoError(t, d.stmts.CreateTeam(t.Context(), team))

	want := make([]string, 0, 5)
	for i := range 5 {
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
	slices.Sort(want)
	drainIncarnation(t, want, orderAsc, func(page database.Page[domain.TeamMembershipField]) (*database.ListResult[*domain.TeamMembership], error) {
		return d.stmts.ListTeamMemberships(t.Context(), &database.ListOptions[domain.TeamMembershipField]{
			Filter: filter, Pagination: page,
		})
	}, func(m *domain.TeamMembership) string { return m.UserID }, 2)
}

func battleUserTeams(t *testing.T, d dialect) {
	t.Helper()
	projectID, schemaURL := ensureUserTestProject(t, d.stmts)
	userID := "usr-teams-" + uniqueSuffix(t)
	require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "Teams")))
	t.Cleanup(func() { _ = d.stmts.DeleteUserByID(context.Background(), projectID, userID) })

	want := make([]string, 0, 5)
	for range 5 {
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
	slices.Sort(want)
	drainIncarnation(t, want, orderAsc, func(page database.Page[domain.UserTeamField]) (*database.ListResult[*domain.UserTeam], error) {
		return d.stmts.ListUserTeams(t.Context(), &database.ListOptions[domain.UserTeamField]{
			Filter: filter, Pagination: page,
		})
	}, func(ut *domain.UserTeam) string { return ut.TeamID }, 2)
}
