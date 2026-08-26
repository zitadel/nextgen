//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Create and Update read the timestamps the database wrote back into the
// entity, so the API can answer with them instead of zero values.
func TestFlowDefinitionStatements_CreateUpdate_ReturnTimestamps(t *testing.T) {
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

		createdAt := def.CreatedAt
		def.Name = "Updated Login"
		def.CreatedAt, def.UpdatedAt = createdAt.AddDate(1, 0, 0), createdAt.AddDate(1, 0, 0)
		require.NoError(t, d.stmts.UpdateFlowDefinition(t.Context(), def))

		assert.Equal(t, createdAt, def.CreatedAt, "created_at is set by the database, not the caller")
		assert.False(t, def.UpdatedAt.Before(createdAt))

		stored, err = d.stmts.GetFlowDefinitionByID(t.Context(), projectID, def.ID)
		require.NoError(t, err)
		assert.Equal(t, stored.UpdatedAt, def.UpdatedAt)
	})
}
