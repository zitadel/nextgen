//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/environment"
)

func ensureEnvironmentProject(t *testing.T, stmts service.AllStatements) string {
	t.Helper()
	projectID := "proj-env-" + uniqueSuffix(t)
	require.NoError(t, stmts.CreateProject(t.Context(), newTestProject(projectID)))
	t.Cleanup(func() { _, _ = stmts.DeleteProjectByID(context.Background(), projectID) })
	return projectID
}

func createEnvironment(t *testing.T, stmts service.AllStatements, projectID, name string) *domain.Environment {
	t.Helper()
	entity, err := domain.NewEnvironment(projectID, name)
	require.NoError(t, err)
	require.NoError(t, stmts.CreateEnvironment(t.Context(), entity))
	return entity
}

func TestEnvironmentStatements_CreateAndGetByName(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureEnvironmentProject(t, d.stmts)

		entity := createEnvironment(t, d.stmts, projectID, "prod")
		// The id is minted by the dialect, not the caller (ADR 047).
		assert.True(t, domain.PrefixEnvironment.Matches(entity.ID), "id %q is not env_-prefixed", entity.ID)
		assert.False(t, entity.CreatedAt.IsZero())
		assert.WithinDuration(t, time.Now(), entity.CreatedAt, 5*time.Second)

		got, err := d.stmts.GetEnvironmentByName(t.Context(), projectID, "prod")
		require.NoError(t, err)
		assert.Equal(t, entity.ProjectID, got.ProjectID)
		assert.Equal(t, entity.ID, got.ID)
		assert.Equal(t, "prod", got.Name)
		assert.WithinDuration(t, entity.CreatedAt, got.CreatedAt, time.Second)
	})
}

func TestEnvironmentStatements_GetByNameUnknownIsNoRowFound(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureEnvironmentProject(t, d.stmts)
		createEnvironment(t, d.stmts, projectID, "dev")

		_, err := d.stmts.GetEnvironmentByName(t.Context(), projectID, "prod")
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

// The name is unique per project, which is what lets it address the resource
// on the wire. Without the constraint a project could hold two `prod` rows and
// GET /environments/prod would answer with whichever one the index reached
// first.
func TestEnvironmentStatements_NameUniquePerProject(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureEnvironmentProject(t, d.stmts)
		createEnvironment(t, d.stmts, projectID, "prod")

		dup, err := domain.NewEnvironment(projectID, "prod")
		require.NoError(t, err)
		err = d.stmts.CreateEnvironment(t.Context(), dup)
		assert.ErrorIs(t, err, new(database.IntegrityViolationError))
	})
}

// The same name in two projects is two different environments: uniqueness is
// scoped to the project, not global.
func TestEnvironmentStatements_NameReusableAcrossProjects(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectA := ensureEnvironmentProject(t, d.stmts)
		projectB := ensureEnvironmentProject(t, d.stmts)

		envA := createEnvironment(t, d.stmts, projectA, "prod")
		envB := createEnvironment(t, d.stmts, projectB, "prod")
		assert.NotEqual(t, envA.ID, envB.ID)

		gotA, err := d.stmts.GetEnvironmentByName(t.Context(), projectA, "prod")
		require.NoError(t, err)
		assert.Equal(t, envA.ID, gotA.ID)

		// A read scoped to project A cannot reach project B's row even though
		// they share a name.
		gotB, err := d.stmts.GetEnvironmentByName(t.Context(), projectB, "prod")
		require.NoError(t, err)
		assert.Equal(t, envB.ID, gotB.ID)
	})
}

func TestEnvironmentStatements_ListIsProjectScopedInPipelineOrder(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureEnvironmentProject(t, d.stmts)
		otherProject := ensureEnvironmentProject(t, d.stmts)

		want := make([]string, 0, len(domain.DefaultEnvironmentNames))
		for _, name := range domain.DefaultEnvironmentNames {
			createEnvironment(t, d.stmts, projectID, name)
			want = append(want, name)
		}
		createEnvironment(t, d.stmts, otherProject, "prod")

		result, err := d.stmts.ListEnvironments(
			unfilteredListCtx(t),
			environment.ListOptions(projectID, 50, nil),
		)
		require.NoError(t, err)

		got := make([]string, 0, len(result.Items))
		for _, item := range result.Items {
			assert.Equal(t, projectID, item.ProjectID)
			got = append(got, item.Name)
		}
		// Oldest first: the seed order is the pipeline order.
		assert.Equal(t, want, got)
	})
}

// The project FK cascades, so deleting a project takes its environments with
// it rather than leaving orphan slots behind.
func TestEnvironmentStatements_ProjectDeleteCascades(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureEnvironmentProject(t, d.stmts)
		createEnvironment(t, d.stmts, projectID, "prod")

		_, err := d.stmts.DeleteProjectByID(t.Context(), projectID)
		require.NoError(t, err)

		result, err := d.stmts.ListEnvironments(
			unfilteredListCtx(t),
			environment.ListOptions(projectID, 50, nil),
		)
		require.NoError(t, err)
		assert.Empty(t, result.Items)
	})
}
