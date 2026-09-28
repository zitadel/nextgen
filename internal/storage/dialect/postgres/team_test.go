//go:build postgres_integration

package postgres

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
)

func uniqueTeamIDs(t *testing.T) (projectID, teamID string) {
	t.Helper()
	suffix := uniqueSuffix(t)
	return "proj-team-" + suffix, "team-" + suffix
}

func ensureTestProject(t *testing.T, projectID string) {
	t.Helper()
	project := newTestProject(projectID)
	require.NoError(t, testPool.CreateProject(t.Context(), project))
	t.Cleanup(func() { _, _ = testPool.DeleteProjectByID(context.Background(), projectID) })
}

// TestDeactivateTeam_rollsBackWhenSecondWriteFails proves multi-write atomicity:
// the team status UPDATE must not be visible when a later write in the same
// withTransaction callback fails.
func TestDeactivateTeam_rollsBackWhenSecondWriteFails(t *testing.T) {
	projectID, teamID := uniqueTeamIDs(t)
	ensureTestProject(t, projectID)
	require.NoError(t, testPool.CreateTeam(t.Context(), newTestTeam(projectID, teamID)))

	forced := errors.New("forced second write failure")
	client := &failAfterNBeginner{Pool: testPool.pool, succeed: 1, err: forced}
	_, err := newTeamStatements(client).DeactivateTeam(t.Context(), projectID, teamID)
	require.ErrorIs(t, err, forced)

	stored, getErr := testPool.GetTeamByID(t.Context(), projectID, teamID)
	require.NoError(t, getErr)
	assert.Equal(t, domain.TeamStatusActive, stored.Status)
}

// failAfterNBeginner wraps *pgxpool.Pool so Begin returns a tx that fails after
// succeed successful Exec calls. Used to force mid-transaction write failures.
type failAfterNBeginner struct {
	*pgxpool.Pool
	succeed int
	err     error
}

func (b *failAfterNBeginner) Begin(ctx context.Context) (pgx.Tx, error) {
	tx, err := b.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	return &failAfterNTx{Tx: tx, remaining: b.succeed, err: b.err}, nil
}

type failAfterNTx struct {
	pgx.Tx
	remaining int
	err       error
}

func (t *failAfterNTx) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	if t.remaining <= 0 {
		return pgconn.CommandTag{}, t.err
	}
	t.remaining--
	return t.Tx.Exec(ctx, sql, args...)
}
