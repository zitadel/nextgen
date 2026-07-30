//go:build postgres_integration

package postgres

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func seedTeamMembershipParents(t *testing.T, projectID, teamID, userID string) {
	t.Helper()
	ctx := t.Context()
	project := newTestProject(projectID)
	require.NoError(t, testPool.CreateProject(ctx, project))
	t.Cleanup(func() { _ = testPool.DeleteProjectByID(context.Background(), projectID) })

	schemaURL := "https://schemas.test/team-membership/v1.json"
	_, err := testPool.pool.Exec(ctx,
		`INSERT INTO zitadel_nextgen.json_schemas (project_id, url, payload) VALUES ($1, $2, $3::json)`,
		projectID, schemaURL, []byte("{}"),
	)
	require.NoError(t, err)

	_, err = testPool.pool.Exec(ctx,
		`INSERT INTO zitadel_nextgen.teams (project_id, id, name) VALUES ($1, $2, $3)`,
		projectID, teamID, "team-"+teamID,
	)
	require.NoError(t, err)
	t.Cleanup(func() {
		cleanupCtx := context.Background()
		_, _ = testPool.pool.Exec(cleanupCtx, `DELETE FROM zitadel_nextgen.team_memberships WHERE project_id = $1`, projectID)
		_, _ = testPool.pool.Exec(cleanupCtx, `DELETE FROM zitadel_nextgen.users WHERE project_id = $1`, projectID)
		_, _ = testPool.pool.Exec(cleanupCtx, `DELETE FROM zitadel_nextgen.teams WHERE project_id = $1`, projectID)
		_, _ = testPool.pool.Exec(cleanupCtx, `DELETE FROM zitadel_nextgen.json_schemas WHERE project_id = $1`, projectID)
	})

	_, err = testPool.pool.Exec(ctx,
		`INSERT INTO zitadel_nextgen.users (project_id, schema_url, id, status) VALUES ($1, $2, $3, $4)`,
		projectID, schemaURL, userID, domain.UserStatusActive.String(),
	)
	require.NoError(t, err)
}

func uniqueTeamMembershipIDs(t *testing.T) (projectID, teamID, userID string) {
	t.Helper()
	suffix := uniqueSuffix(t)
	return "proj-tm-" + suffix, "team-tm-" + suffix, "usr-tm-" + suffix
}

func TestTeamMembershipStatements_CreateGetListUpdate(t *testing.T) {
	projectID, teamID, userID := uniqueTeamMembershipIDs(t)
	seedTeamMembershipParents(t, projectID, teamID, userID)

	membership := &domain.TeamMembership{
		ProjectID: projectID,
		TeamID:    teamID,
		UserID:    userID,
		Status:    domain.MembershipStatusActive,
	}
	require.NoError(t, testPool.CreateTeamMembership(t.Context(), membership))
	assert.False(t, membership.CreatedAt.IsZero())
	assert.False(t, membership.UpdatedAt.IsZero())
	assert.Equal(t, domain.MembershipStatusActive, membership.Status)

	got, err := testPool.GetTeamMembership(t.Context(), projectID, teamID, userID)
	require.NoError(t, err)
	assert.Equal(t, projectID, got.ProjectID)
	assert.Equal(t, teamID, got.TeamID)
	assert.Equal(t, userID, got.UserID)
	assert.Equal(t, domain.MembershipStatusActive, got.Status)

	listedByUser, err := testPool.ListTeamMemberships(t.Context(), &database.ListOptions[domain.TeamMembershipField]{
		Filter: database.And(
			database.Equal(database.Col(domain.TeamMembershipFieldProjectID), projectID),
			database.Equal(database.Col(domain.TeamMembershipFieldUserID), userID),
		),
	})
	require.NoError(t, err)
	require.Len(t, listedByUser.Items, 1)
	assert.Equal(t, teamID, listedByUser.Items[0].TeamID)

	listedByTeam, err := testPool.ListTeamMemberships(t.Context(), &database.ListOptions[domain.TeamMembershipField]{
		Filter: database.And(
			database.Equal(database.Col(domain.TeamMembershipFieldProjectID), projectID),
			database.Equal(database.Col(domain.TeamMembershipFieldTeamID), teamID),
		),
	})
	require.NoError(t, err)
	require.Len(t, listedByTeam.Items, 1)
	assert.Equal(t, userID, listedByTeam.Items[0].UserID)

	empty, err := testPool.ListTeamMemberships(t.Context(), &database.ListOptions[domain.TeamMembershipField]{
		Filter: database.And(
			database.Equal(database.Col(domain.TeamMembershipFieldProjectID), projectID),
			database.Equal(database.Col(domain.TeamMembershipFieldUserID), "missing-user"),
		),
	})
	require.NoError(t, err)
	assert.Empty(t, empty.Items)

	require.NoError(t, testPool.UpdateTeamMembershipStatus(t.Context(), projectID, teamID, userID, domain.MembershipStatusRemoved))
	updated, err := testPool.GetTeamMembership(t.Context(), projectID, teamID, userID)
	require.NoError(t, err)
	assert.Equal(t, domain.MembershipStatusRemoved, updated.Status)
}

func TestTeamMembershipStatements_Get_NotFound(t *testing.T) {
	_, err := testPool.GetTeamMembership(t.Context(), "missing-proj", "missing-team", "missing-user")
	assert.ErrorIs(t, err, new(database.NoRowFoundError))
}

func TestTeamMembershipStatements_UpdateStatus_NotFound(t *testing.T) {
	err := testPool.UpdateTeamMembershipStatus(t.Context(), "missing-proj", "missing-team", "missing-user", domain.MembershipStatusInactive)
	assert.ErrorIs(t, err, new(database.NoRowFoundError))
}
