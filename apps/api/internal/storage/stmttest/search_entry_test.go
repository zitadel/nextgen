//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// searchEntryIDs is what a search of kind for prefix finds, as resource id and
// matched text, in the order of the read.
func searchEntryIDs(t *testing.T, stmts service.AllStatements, kind domain.ResourceKind, projectID, prefix string) []string {
	t.Helper()
	matches, err := stmts.SearchEntries(unfilteredListCtx(t), kind, projectID, prefix, 20)
	require.NoError(t, err)
	found := make([]string, 0, len(matches))
	for _, match := range matches {
		found = append(found, match.ResourceID+" "+match.MatchedText)
	}
	return found
}

// The statements that write a team, a flow definition, a user schema and a
// connection keep their search entry current, and a search reads one range of
// them: the texts starting with the prefix, in text order.
func TestSearchEntryStatements(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("a team is found by its name and its later words, and renamed", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			team := &domain.Team{ProjectID: projectID, Name: "Payments Alpha"}
			require.NoError(t, d.stmts.CreateTeam(t.Context(), team))
			other := &domain.Team{ProjectID: projectID, Name: "Alpine"}
			require.NoError(t, d.stmts.CreateTeam(t.Context(), other))

			assert.Equal(t, []string{team.ID + " payments alpha"}, searchEntryIDs(t, d.stmts, domain.ResourceKindTeam, projectID, "pay"))
			assert.Equal(t, []string{team.ID + " alpha", other.ID + " alpine"}, searchEntryIDs(t, d.stmts, domain.ResourceKindTeam, projectID, "alp"))

			matches, err := d.stmts.SearchEntries(unfilteredListCtx(t), domain.ResourceKindTeam, projectID, "alp", 20)
			require.NoError(t, err)
			require.Len(t, matches, 2)
			assert.Equal(t, domain.SearchEntryMatch{
				ResourceID:  team.ID,
				ProjectID:   projectID,
				Title:       "Payments Alpha",
				MatchedText: "alpha",
			}, matches[0])
			assert.True(t, matches[1].NameStart)

			team.Name = "Billing"
			require.NoError(t, d.stmts.UpdateTeam(t.Context(), team))
			assert.Empty(t, searchEntryIDs(t, d.stmts, domain.ResourceKindTeam, projectID, "pay"))
			assert.Equal(t, []string{team.ID + " billing"}, searchEntryIDs(t, d.stmts, domain.ResourceKindTeam, projectID, "bil"))
		})

		t.Run("the read stops at the limit and stays in its project and kind", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			otherProjectID := ensureProject(t, d.stmts)
			for _, name := range []string{"Ops One", "Ops Two", "Ops Three"} {
				require.NoError(t, d.stmts.CreateTeam(t.Context(), &domain.Team{ProjectID: projectID, Name: name}))
			}
			require.NoError(t, d.stmts.CreateTeam(t.Context(), &domain.Team{ProjectID: otherProjectID, Name: "Ops Elsewhere"}))

			matches, err := d.stmts.SearchEntries(unfilteredListCtx(t), domain.ResourceKindTeam, projectID, "ops", 2)
			require.NoError(t, err)
			require.Len(t, matches, 2)
			assert.Equal(t, []string{"ops one", "ops three"}, []string{matches[0].MatchedText, matches[1].MatchedText})

			assert.Empty(t, searchEntryIDs(t, d.stmts, domain.ResourceKindFlowDefinition, projectID, "ops"))
		})

		t.Run("a flow definition answers with its newest revision", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			first := createFlowDefinitionRevision(t, d.stmts, projectID, "flowdef_"+uniqueSuffix(t), "Partner Sign In")
			second := createFlowDefinitionRevision(t, d.stmts, projectID, "flowdef_"+uniqueSuffix(t), "Partner Sign In")

			assert.Equal(t, []string{second.ID + " sign in"}, searchEntryIDs(t, d.stmts, domain.ResourceKindFlowDefinition, projectID, "sign"))

			// Deleting the newest revision points search at the one left, and
			// deleting that one leaves nothing to find.
			require.NoError(t, d.stmts.DeleteFlowDefinitionByID(t.Context(), projectID, second.ID))
			assert.Equal(t, []string{first.ID + " sign in"}, searchEntryIDs(t, d.stmts, domain.ResourceKindFlowDefinition, projectID, "sign"))
			require.NoError(t, d.stmts.DeleteFlowDefinitionByID(t.Context(), projectID, first.ID))
			assert.Empty(t, searchEntryIDs(t, d.stmts, domain.ResourceKindFlowDefinition, projectID, "sign"))
		})

		t.Run("a user schema is found by its title and object type at its newest revision", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			objectType := "partner-user"
			newSchema := func(title string) *domain.JSONSchema {
				schema := &domain.JSONSchema{
					ProjectID:  projectID,
					ObjectType: &objectType,
					Kind:       domain.JSONSchemaKindUserSchema,
					Schema:     []byte(`{"title":"` + title + `"}`),
				}
				require.NoError(t, d.stmts.CreateJSONSchema(t.Context(), schema))
				t.Cleanup(func() { _ = d.stmts.DeleteJSONSchemaByID(context.Background(), projectID, schema.URL) })
				return schema
			}
			first := newSchema("Partner Staff")
			second := newSchema("Partner Crew")
			// A schema user schemas refer to is not searched.
			createJSONSchemaWithKind(t, d.stmts, projectID, "sch_"+uniqueSuffix(t), domain.JSONSchemaKindUnknown)

			assert.Empty(t, searchEntryIDs(t, d.stmts, domain.ResourceKindSchema, projectID, "staff"))
			assert.Equal(t, []string{second.URL + " crew"}, searchEntryIDs(t, d.stmts, domain.ResourceKindSchema, projectID, "crew"))
			assert.Equal(t, []string{second.URL + " partner crew", second.URL + " partner-user"},
				searchEntryIDs(t, d.stmts, domain.ResourceKindSchema, projectID, "partner"))

			require.NoError(t, d.stmts.DeleteJSONSchemaByID(t.Context(), projectID, second.URL))
			assert.Equal(t, []string{first.URL + " staff"}, searchEntryIDs(t, d.stmts, domain.ResourceKindSchema, projectID, "staff"))
		})

		t.Run("a connection is found by its slug and its newest display name", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			connection := createIDPConnection(t, d.stmts, projectID, "partner-sso", []byte(`{"display_name":"Partner Portal"}`))

			assert.Equal(t, []string{connection.ID + " portal", connection.ID + " sso"}, func() []string {
				found := searchEntryIDs(t, d.stmts, domain.ResourceKindIDPConnection, projectID, "portal")
				return append(found, searchEntryIDs(t, d.stmts, domain.ResourceKindIDPConnection, projectID, "sso")...)
			}())

			connection.Document = []byte(`{"display_name":"Partner Gateway"}`)
			require.NoError(t, d.stmts.ReviseIDPConnection(t.Context(), connection))
			assert.Empty(t, searchEntryIDs(t, d.stmts, domain.ResourceKindIDPConnection, projectID, "portal"))
			matches, err := d.stmts.SearchEntries(unfilteredListCtx(t), domain.ResourceKindIDPConnection, projectID, "gate", 20)
			require.NoError(t, err)
			require.Len(t, matches, 1)
			assert.Equal(t, "Partner Gateway", matches[0].Title)
			assert.Equal(t, "partner-sso", matches[0].Subtitle)
		})

		t.Run("a search without a list filter is refused", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			_, err := d.stmts.SearchEntries(t.Context(), domain.ResourceKindTeam, projectID, "a", 5)
			require.ErrorIs(t, err, service.ErrListFilterRequired)
		})
	})
}
