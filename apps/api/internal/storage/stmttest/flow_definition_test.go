//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// Create reads the timestamps the database wrote back into the entity, so
// the API can answer with them instead of zero values.
func TestFlowDefinitionStatements_Create_ReturnTimestamps(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		def := sampleFlowDefinition(projectID, "flowdef_"+uniqueSuffix(t), "Default Login")
		require.NoError(t, d.stmts.CreateFlowDefinition(t.Context(), def))
		t.Cleanup(func() { _ = d.stmts.DeleteFlowDefinitionByID(context.Background(), projectID, def.ID) })

		require.False(t, def.CreatedAt.IsZero())
		assert.Equal(t, def.CreatedAt, def.UpdatedAt)

		stored, err := d.stmts.GetFlowDefinitionByID(t.Context(), projectID, def.ID)
		require.NoError(t, err)
		assert.Equal(t, stored.CreatedAt, def.CreatedAt)
		assert.Equal(t, stored.UpdatedAt, def.UpdatedAt)
	})
}

// createFlowDefinitionRevision publishes one revision of name and returns it
// with the created_at the dialect assigned.
func createFlowDefinitionRevision(t *testing.T, stmts service.AllStatements, projectID, id, name string) *domain.FlowDefinition {
	t.Helper()
	def := sampleFlowDefinition(projectID, id, name)
	require.NoError(t, stmts.CreateFlowDefinition(t.Context(), def))
	t.Cleanup(func() { _ = stmts.DeleteFlowDefinitionByID(context.Background(), projectID, id) })
	return def
}

func listFlowDefinitionIDs(t *testing.T, stmts service.AllStatements, projectID string, opts service.FlowDefinitionQueryOptions) []string {
	t.Helper()
	result, err := stmts.ListFlowDefinitions(unfilteredListCtx(t), &database.ListOptions[domain.FlowDefinitionField]{
		Filter: database.Equal(database.Col(domain.FlowDefinitionFieldProjectID), projectID),
	}, opts)
	require.NoError(t, err)
	ids := make([]string, 0, len(result.Items))
	for _, item := range result.Items {
		ids = append(ids, item.ID)
	}
	slices.Sort(ids)
	return ids
}

func TestFlowDefinitionStatements_ListLatestRevisionPerName(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		suffix := uniqueSuffix(t)

		login := "login-" + suffix
		register := "register-" + suffix

		// Written in order, so each revision is newer than the one before it.
		loginV1 := createFlowDefinitionRevision(t, d.stmts, projectID, "flowdef_"+suffix+"_login1", login)
		loginV2 := createFlowDefinitionRevision(t, d.stmts, projectID, "flowdef_"+suffix+"_login2", login)
		registerV1 := createFlowDefinitionRevision(t, d.stmts, projectID, "flowdef_"+suffix+"_register1", register)

		require.True(t, loginV1.CreatedAt.Before(loginV2.CreatedAt),
			"revisions of one flow must not share a created_at")

		all := listFlowDefinitionIDs(t, d.stmts, projectID, service.FlowDefinitionQueryOptions{})
		assert.Equal(t, []string{loginV1.ID, loginV2.ID, registerV1.ID}, all)

		latest := listFlowDefinitionIDs(t, d.stmts, projectID, service.FlowDefinitionQueryOptions{
			LatestRevisionPerName: true,
		})
		assert.Equal(t, []string{loginV2.ID, registerV1.ID}, latest)
	})
}

// Latest mode reads created_at as a total order within a flow name, so two
// revisions sharing one has no determinate answer. The unique index rejects
// the second write instead of letting the ambiguity reach a reader.
func TestFlowDefinitionStatements_RejectsTiedRevisionTimestamps(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		suffix := uniqueSuffix(t)
		name := "tied-" + suffix
		tiedAt := time.Now().UTC().Truncate(time.Microsecond)

		first := "flowdef_" + suffix + "_first"
		require.NoError(t, d.insertFlowDefinitionAt(t.Context(), projectID, first, name, tiedAt))
		t.Cleanup(func() { _ = d.stmts.DeleteFlowDefinitionByID(context.Background(), projectID, first) })

		second := "flowdef_" + suffix + "_second"
		err := d.insertFlowDefinitionAt(t.Context(), projectID, second, name, tiedAt)
		assert.ErrorIs(t, err, new(database.UniqueError))

		// A different flow at the same instant is a different history and
		// stays allowed.
		otherName := "untied-" + suffix
		other := "flowdef_" + suffix + "_other"
		require.NoError(t, d.insertFlowDefinitionAt(t.Context(), projectID, other, otherName, tiedAt))
		t.Cleanup(func() { _ = d.stmts.DeleteFlowDefinitionByID(context.Background(), projectID, other) })
	})
}
