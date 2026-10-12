//go:build postgres_integration

package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The project lock a deploy holds serializes deploys and revokes, and nothing
// else: a row inserted under the project, as a sign-in does, goes through
// while the deploy runs.
func TestLockProject_BlocksDeploysNotInsertsUnderTheProject(t *testing.T) {
	projectID := uniqueProjectID(t)
	ensureTestProject(t, projectID)

	deploy, err := testPool.pool.Begin(t.Context())
	require.NoError(t, err)
	t.Cleanup(func() { _ = deploy.Rollback(context.Background()) })
	require.NoError(t, newProjectStatements(deploy).LockProject(t.Context(), projectID))

	insertCtx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	require.NoError(t, testPool.CreateTeam(insertCtx, newTestTeam(projectID, "team-"+uniqueSuffix(t))),
		"an insert referencing the project waited on the deploy's lock")

	second, err := testPool.pool.Begin(t.Context())
	require.NoError(t, err)
	t.Cleanup(func() { _ = second.Rollback(context.Background()) })
	waitCtx, cancelWait := context.WithTimeout(t.Context(), 300*time.Millisecond)
	defer cancelWait()
	err = newProjectStatements(second).LockProject(waitCtx, projectID)
	assert.Error(t, err, "a second deploy took the lock while the first held it")
}
