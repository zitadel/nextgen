//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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
