//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"testing"

	"github.com/go-jose/go-jose/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// ListSigningKeys returns every key its filter matches, and only the
// filtered project's.
func TestSigningKeyStatements_List(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, otherProjectID := uniqueProjectID(t), uniqueProjectID(t)
		for _, id := range []string{projectID, otherProjectID} {
			require.NoError(t, d.stmts.CreateProject(t.Context(), newTestProject(id)))
			t.Cleanup(func() { _, _ = d.stmts.DeleteProjectByID(context.Background(), id) })
		}

		create := func(projectID string, state domain.KeyState) *domain.SigningKey {
			t.Helper()
			key := &domain.SigningKey{
				ProjectID: projectID,
				Purpose:   domain.SigningKeyPurposeToken,
				Key:       "encrypted-seed",
				Algorithm: jose.EdDSA,
				State:     state,
			}
			require.NoError(t, d.stmts.CreateSigningKey(t.Context(), key))
			return key
		}
		expired := create(projectID, domain.KeyStateExpired)
		active := create(projectID, domain.KeyStateActive)
		queued := create(projectID, domain.KeyStateNotActiveYet)
		create(projectID, domain.KeyStateRemoved)
		create(otherProjectID, domain.KeyStateActive)

		keys, err := d.stmts.ListSigningKeys(t.Context(), database.And(
			database.Equal(database.Col(domain.SigningKeyFieldProjectID), projectID),
			database.Not(database.Equal(database.Col(domain.SigningKeyFieldState), domain.KeyStateRemoved)),
		))
		require.NoError(t, err)
		ids := make([]string, 0, len(keys))
		for _, key := range keys {
			ids = append(ids, key.ID)
			assert.Equal(t, projectID, key.ProjectID)
		}
		assert.ElementsMatch(t, []string{expired.ID, active.ID, queued.ID}, ids)

		none, err := d.stmts.ListSigningKeys(t.Context(), database.Equal(database.Col(domain.SigningKeyFieldProjectID), uniqueProjectID(t)))
		require.NoError(t, err)
		assert.Empty(t, none)
	})
}
