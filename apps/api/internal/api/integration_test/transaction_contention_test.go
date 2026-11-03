//go:build spanner_integration

package integration_test

import (
	"context"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/api/integration_test/helpers"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// contendingWriters is deliberately larger than the emulator's one-transaction-at-a-time
// limit so every run forces real aborts rather than relying on unlucky timing.
const contendingWriters = 8

// TestTransactionContention is the retry canary. Concurrent read-modify-write
// transactions on a single row must all commit: Spanner aborts the losers of a
// conflict, and ReadWriteTransaction is expected to retry them transparently. A
// raw ABORTED escaping to the caller here means something on the path stripped
// the gRPC status off the error and defeated that retry (see #788).
//
// Each writer appends one character to the same team name under a transaction,
// so the final length also proves no update was lost to a retry that replayed
// stale state.
//
// Spanner-only on purpose. Postgres opens transactions at the server default
// READ COMMITTED and sets no isolation level anywhere, so the same read-modify-write
// silently loses updates (this test caught 3 of 8 writers surviving) without ever
// raising a serialization error there is anything to retry. That is tracked
// separately in #791; re-tag this test to run on Postgres as part of fixing it.
func TestTransactionContention(t *testing.T) {
	t.Parallel()

	project, err := harness.EnsureProjectService(t).Create(t.Context(), helpers.ProjectName(), nil, true)
	require.NoError(t, err)

	team, err := domain.NewTeam(project.ID, helpers.TeamName())
	require.NoError(t, err)
	require.NoError(t, harness.DB.Transaction(t.Context(), func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
		return tx.Statements().CreateTeam(ctx, team)
	}))
	initialLen := len(team.Name)

	start := make(chan struct{})
	errs := make([]error, contendingWriters)

	var wg sync.WaitGroup
	for i := range contendingWriters {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start // release together so the transactions genuinely overlap
			errs[i] = harness.DB.Transaction(t.Context(), func(ctx context.Context, tx service.Statementer[service.AllStatements]) error {
				current, err := tx.Statements().GetTeamByID(ctx, project.ID, team.ID)
				if err != nil {
					return err
				}
				current.Name += "x"
				return tx.Statements().UpdateTeam(ctx, current)
			})
		}()
	}
	close(start)
	wg.Wait()

	for i, err := range errs {
		assert.NoErrorf(t, err, "writer %d failed; a conflict should have been retried, not surfaced", i)
	}

	final, err := harness.DB.Statements().GetTeamByID(t.Context(), project.ID, team.ID)
	require.NoError(t, err)
	assert.Len(t, final.Name, initialLen+contendingWriters,
		"lost update: a retried transaction replayed stale state")
}
