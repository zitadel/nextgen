//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func TestResourceScopeStatements_UpsertGetDelete(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		t.Run("project create dual-writes scope; upsert preserves created_at", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)

			scope, err := d.stmts.GetResourceScope(t.Context(), projectID)
			require.NoError(t, err)
			assert.Equal(t, domain.ResourceKindProject, scope.ResourceKind)
			assert.Equal(t, projectID, scope.ProjectID)
			assert.Nil(t, scope.TeamID)
			createdAt := scope.CreatedAt

			require.NoError(t, d.stmts.UpsertResourceScope(t.Context(), &domain.ResourceScope{
				ResourceID: projectID, ResourceKind: domain.ResourceKindProject, ProjectID: projectID,
			}))
			scope, err = d.stmts.GetResourceScope(t.Context(), projectID)
			require.NoError(t, err)
			assert.Equal(t, createdAt.UTC(), scope.CreatedAt.UTC())
		})

		t.Run("team create dual-writes scope", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			teamID := "team-rsi-" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamID)))

			teamScope, err := d.stmts.GetResourceScope(t.Context(), teamID)
			require.NoError(t, err)
			require.NotNil(t, teamScope.TeamID)
			assert.Equal(t, teamID, *teamScope.TeamID)
			assert.Equal(t, domain.ResourceKindTeam, teamScope.ResourceKind)
		})

		t.Run("delete removes row; missing delete is ok", func(t *testing.T) {
			projectID := ensureProject(t, d.stmts)
			require.NoError(t, d.stmts.DeleteResourceScope(t.Context(), projectID))
			_, err := d.stmts.GetResourceScope(t.Context(), projectID)
			assert.ErrorIs(t, err, new(database.NoRowFoundError))
			require.NoError(t, d.stmts.DeleteResourceScope(t.Context(), "missing-"+uniqueSuffix(t)))
		})
	})
}

func TestProjectStatements_Delete_removesResourceScope(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		project := newTestProject(uniqueProjectID(t))
		require.NoError(t, d.stmts.CreateProject(t.Context(), project))
		_, err := d.stmts.GetResourceScope(t.Context(), project.ID)
		require.NoError(t, err)

		require.NoError(t, d.stmts.DeleteProjectByID(t.Context(), project.ID))
		_, err = d.stmts.GetResourceScope(t.Context(), project.ID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}
