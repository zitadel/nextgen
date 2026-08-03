//go:build postgres_integration

package postgres

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
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
	t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), projectID) })
}

func TestTeamStatements_Create(t *testing.T) {
	t.Run("creates team and timestamps are set", func(t *testing.T) {
		projectID, teamID := uniqueTeamIDs(t)
		ensureTestProject(t, projectID)

		team := newTestTeam(projectID, teamID)
		require.NoError(t, testPool.CreateTeam(t.Context(), team))
		assert.Equal(t, domain.TeamStatusActive, team.Status)
		assert.False(t, team.CreatedAt.IsZero())
		assert.False(t, team.UpdatedAt.IsZero())
		assert.WithinDuration(t, time.Now(), team.CreatedAt, 5*time.Second)

		stored, err := testPool.GetTeamByID(t.Context(), projectID, teamID)
		require.NoError(t, err)
		assert.Equal(t, projectID, stored.ProjectID)
		assert.Equal(t, teamID, stored.ID)
		assert.Equal(t, team.Name, stored.Name)
		assert.Equal(t, domain.TeamStatusActive, stored.Status)
	})

	t.Run("empty id is assigned by dialect", func(t *testing.T) {
		projectID, _ := uniqueTeamIDs(t)
		ensureTestProject(t, projectID)

		team := newTestTeam(projectID, "")
		require.NoError(t, testPool.CreateTeam(t.Context(), team))
		require.NotEmpty(t, team.ID)
		assert.True(t, strings.HasPrefix(team.ID, string(domain.PrefixTeam)+"_"))

		stored, err := testPool.GetTeamByID(t.Context(), projectID, team.ID)
		require.NoError(t, err)
		assert.Equal(t, team.ID, stored.ID)
	})

	t.Run("name violating the column check returns error", func(t *testing.T) {
		for _, tc := range []struct {
			name     string
			teamName string
		}{
			{"empty", ""},
			{"over the length limit", strings.Repeat("a", domain.TeamNameMaxLength+1)},
		} {
			t.Run(tc.name, func(t *testing.T) {
				projectID, teamID := uniqueTeamIDs(t)
				ensureTestProject(t, projectID)

				team := newTestTeam(projectID, teamID)
				team.Name = tc.teamName
				assert.ErrorIs(t, testPool.CreateTeam(t.Context(), team), new(database.CheckError))
			})
		}
	})

	t.Run("duplicate (project_id, id) returns error", func(t *testing.T) {
		projectID, teamID := uniqueTeamIDs(t)
		ensureTestProject(t, projectID)

		team := newTestTeam(projectID, teamID)
		require.NoError(t, testPool.CreateTeam(t.Context(), team))

		err := testPool.CreateTeam(t.Context(), newTestTeam(projectID, teamID))
		assert.Error(t, err)
	})

	t.Run("duplicate name in the same project returns error", func(t *testing.T) {
		for _, tc := range []struct {
			name    string
			nameFor func(string) string
		}{
			{"exact match", func(name string) string { return name }},
			{"differing only in case", strings.ToUpper},
		} {
			t.Run(tc.name, func(t *testing.T) {
				projectID, teamID := uniqueTeamIDs(t)
				ensureTestProject(t, projectID)

				team := newTestTeam(projectID, teamID)
				require.NoError(t, testPool.CreateTeam(t.Context(), team))

				duplicate := newTestTeam(projectID, teamID+"-2")
				duplicate.Name = tc.nameFor(team.Name)
				err := testPool.CreateTeam(t.Context(), duplicate)
				assert.ErrorIs(t, err, new(database.UniqueError))
			})
		}
	})

	t.Run("same name in different projects is allowed", func(t *testing.T) {
		projectID, teamID := uniqueTeamIDs(t)
		ensureTestProject(t, projectID)
		otherProjectID := projectID + "-other"
		ensureTestProject(t, otherProjectID)

		team := newTestTeam(projectID, teamID)
		require.NoError(t, testPool.CreateTeam(t.Context(), team))

		other := newTestTeam(otherProjectID, teamID)
		other.Name = team.Name
		require.NoError(t, testPool.CreateTeam(t.Context(), other))
	})
}

func TestTeamStatements_Get(t *testing.T) {
	t.Run("returns team by project_id and id", func(t *testing.T) {
		projectID, teamID := uniqueTeamIDs(t)
		ensureTestProject(t, projectID)
		team := newTestTeam(projectID, teamID)
		require.NoError(t, testPool.CreateTeam(t.Context(), team))

		stored, err := testPool.GetTeamByID(t.Context(), projectID, teamID)
		require.NoError(t, err)
		assert.Equal(t, projectID, stored.ProjectID)
		assert.Equal(t, teamID, stored.ID)
		assert.Equal(t, team.Name, stored.Name)
		assert.False(t, stored.CreatedAt.IsZero())
	})

	t.Run("not found returns NoRowFoundError", func(t *testing.T) {
		_, err := testPool.GetTeamByID(t.Context(), "proj-nonexistent", "team-nonexistent")
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

func TestTeamStatements_UpdateTeam(t *testing.T) {
	t.Run("updates team", func(t *testing.T) {
		projectID, teamID := uniqueTeamIDs(t)
		ensureTestProject(t, projectID)
		team := newTestTeam(projectID, teamID)
		require.NoError(t, testPool.CreateTeam(t.Context(), team))
		createdAt, updatedAt := team.CreatedAt, team.UpdatedAt

		team.Name = "updated name"
		require.NoError(t, testPool.UpdateTeam(t.Context(), team))
		assert.Equal(t, "updated name", team.Name)
		assert.Equal(t, projectID, team.ProjectID)
		assert.Equal(t, teamID, team.ID)
		assert.Equal(t, domain.TeamStatusActive, team.Status)
		assert.Equal(t, createdAt, team.CreatedAt)
		assert.True(t, team.UpdatedAt.After(updatedAt))
	})

	t.Run("team not found returns NoRowFoundError", func(t *testing.T) {
		projectID, _ := uniqueTeamIDs(t)
		ensureTestProject(t, projectID)
		team := newTestTeam(projectID, "nonexistent")
		assert.ErrorIs(t,
			testPool.UpdateTeam(t.Context(), team),
			new(database.NoRowFoundError),
		)
	})

	t.Run("deactivated team returns NoRowFoundError", func(t *testing.T) {
		projectID, teamID := uniqueTeamIDs(t)
		ensureTestProject(t, projectID)
		team := newTestTeam(projectID, teamID)
		require.NoError(t, testPool.CreateTeam(t.Context(), team))
		require.NoError(t, testPool.DeactivateTeam(t.Context(), projectID, teamID))

		team.Name = "updated name"
		assert.ErrorIs(t,
			testPool.UpdateTeam(t.Context(), team),
			new(database.NoRowFoundError),
		)
	})

	t.Run("name violates uniqueness constraint", func(t *testing.T) {
		projectID, teamID := uniqueTeamIDs(t)
		ensureTestProject(t, projectID)
		team := newTestTeam(projectID, teamID)
		require.NoError(t, testPool.CreateTeam(t.Context(), team))

		taken := newTestTeam(projectID, teamID+"-taken")
		require.NoError(t, testPool.CreateTeam(t.Context(), taken))

		team.Name = taken.Name
		assert.ErrorIs(t,
			testPool.UpdateTeam(t.Context(), team),
			new(database.UniqueError),
		)

		// a case-only difference still collides.
		team.Name = strings.ToUpper(taken.Name)
		assert.ErrorIs(t,
			testPool.UpdateTeam(t.Context(), team),
			new(database.UniqueError),
		)
	})

	t.Run("unchanged name", func(t *testing.T) {
		projectID, teamID := uniqueTeamIDs(t)
		ensureTestProject(t, projectID)
		team := newTestTeam(projectID, teamID)
		require.NoError(t, testPool.CreateTeam(t.Context(), team))
		name := team.Name

		// The row already holds the name it is updated to, so the unique index
		// must not read it as a collision.
		require.NoError(t, testPool.UpdateTeam(t.Context(), team))
		assert.Equal(t, name, team.Name)
	})

	t.Run("same name in another project", func(t *testing.T) {
		projectID, teamID := uniqueTeamIDs(t)
		ensureTestProject(t, projectID)
		team := newTestTeam(projectID, teamID)
		require.NoError(t, testPool.CreateTeam(t.Context(), team))

		otherProjectID, otherTeamID := uniqueTeamIDs(t)
		ensureTestProject(t, otherProjectID)
		other := newTestTeam(otherProjectID, otherTeamID)
		require.NoError(t, testPool.CreateTeam(t.Context(), other))

		other.Name = team.Name
		require.NoError(t, testPool.UpdateTeam(t.Context(), other))
		assert.Equal(t, team.Name, other.Name)
	})
}

func TestTeamStatements_Deactivate(t *testing.T) {
	projectID, teamID := uniqueTeamIDs(t)
	ensureTestProject(t, projectID)
	require.NoError(t, testPool.CreateTeam(t.Context(), newTestTeam(projectID, teamID)))

	// DeactivateTeam opens its own withTransaction when called via pool.Statements().
	require.NoError(t, testPool.DeactivateTeam(t.Context(), projectID, teamID))

	stored, err := testPool.GetTeamByID(t.Context(), projectID, teamID)
	require.NoError(t, err)
	assert.Equal(t, domain.TeamStatusDeactivated, stored.Status)
}

func TestTeamStatements_Deactivate_CascadesMembershipsAndOwnedUsers(t *testing.T) {
	projectID, ownerTeamID := uniqueTeamIDs(t)
	_, otherTeamID := uniqueTeamIDs(t)
	ensureTestProject(t, projectID)
	require.NoError(t, testPool.CreateTeam(t.Context(), newTestTeam(projectID, ownerTeamID)))
	require.NoError(t, testPool.CreateTeam(t.Context(), newTestTeam(projectID, otherTeamID)))

	schemaURL := "https://schemas.test/team-cascade/" + ownerTeamID + ".json"
	_, err := testPool.pool.Exec(t.Context(),
		`INSERT INTO zitadel_nextgen.json_schemas (project_id, url, payload) VALUES ($1, $2, $3::jsonb)`,
		projectID, schemaURL, []byte("{}"),
	)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = testPool.pool.Exec(context.Background(),
			`DELETE FROM zitadel_nextgen.json_schemas WHERE project_id = $1 AND url = $2`, projectID, schemaURL)
	})

	selfOwnedID := "usr-self-" + ownerTeamID
	teamOwnedID := "usr-owned-" + ownerTeamID
	_, err = testPool.pool.Exec(t.Context(),
		`INSERT INTO zitadel_nextgen.users (project_id, id, schema_url, lifecycle_owner_team_id, status)
		 VALUES ($1, $2, $3, NULL, $4)`,
		projectID, selfOwnedID, schemaURL, domain.UserStatusActive.String(),
	)
	require.NoError(t, err)
	_, err = testPool.pool.Exec(t.Context(),
		`INSERT INTO zitadel_nextgen.users (project_id, id, schema_url, lifecycle_owner_team_id, status)
		 VALUES ($1, $2, $3, $4, $5)`,
		projectID, teamOwnedID, schemaURL, ownerTeamID, domain.UserStatusActive.String(),
	)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = testPool.pool.Exec(context.Background(),
			`DELETE FROM zitadel_nextgen.users WHERE project_id = $1 AND id = ANY($2)`,
			projectID, []string{selfOwnedID, teamOwnedID})
	})

	for _, row := range []struct{ teamID, userID string }{
		{ownerTeamID, selfOwnedID},
		{ownerTeamID, teamOwnedID},
		{otherTeamID, teamOwnedID},
	} {
		_, err = testPool.pool.Exec(t.Context(),
			`INSERT INTO zitadel_nextgen.team_memberships (project_id, team_id, user_id, status)
			 VALUES ($1, $2, $3, $4)`,
			projectID, row.teamID, row.userID, domain.MembershipStatusActive.String(),
		)
		require.NoError(t, err)
	}
	t.Cleanup(func() {
		_, _ = testPool.pool.Exec(context.Background(),
			`DELETE FROM zitadel_nextgen.team_memberships WHERE project_id = $1`, projectID)
	})

	require.NoError(t, testPool.DeactivateTeam(t.Context(), projectID, ownerTeamID))

	var selfStatus, ownedStatus string
	require.NoError(t, testPool.pool.QueryRow(t.Context(),
		`SELECT status FROM zitadel_nextgen.users WHERE project_id = $1 AND id = $2`,
		projectID, selfOwnedID).Scan(&selfStatus))
	require.NoError(t, testPool.pool.QueryRow(t.Context(),
		`SELECT status FROM zitadel_nextgen.users WHERE project_id = $1 AND id = $2`,
		projectID, teamOwnedID).Scan(&ownedStatus))
	assert.Equal(t, domain.UserStatusActive.String(), selfStatus)
	assert.Equal(t, domain.UserStatusDeactivated.String(), ownedStatus)

	for _, row := range []struct{ teamID, userID string }{
		{ownerTeamID, selfOwnedID},
		{ownerTeamID, teamOwnedID},
		{otherTeamID, teamOwnedID},
	} {
		var membershipStatus string
		require.NoError(t, testPool.pool.QueryRow(t.Context(),
			`SELECT status FROM zitadel_nextgen.team_memberships WHERE project_id = $1 AND team_id = $2 AND user_id = $3`,
			projectID, row.teamID, row.userID).Scan(&membershipStatus))
		assert.Equal(t, domain.MembershipStatusRemoved.String(), membershipStatus,
			"membership team=%s user=%s", row.teamID, row.userID)
	}
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
	err := newTeamStatements(client).DeactivateTeam(t.Context(), projectID, teamID)
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
