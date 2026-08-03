//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func TestAuthAttemptStatements_Handoff(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("sets handed_off_at on success", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			_, attempt := handoffCompletedAttempt(t, d.stmts, projectID, nil)
			require.NotNil(t, attempt.HandedOffAt)
			assert.False(t, attempt.HandedOffAt.IsZero())
		})

		t.Run("missing attempt returns NoRowFoundError", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			err := d.stmts.HandoffAuthAttempt(t.Context(), newMissingHandoffAttempt(projectID))
			assert.ErrorIs(t, err, new(database.NoRowFoundError))
		})
	})
}
