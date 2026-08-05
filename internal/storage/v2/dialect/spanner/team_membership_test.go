//go:build spanner_integration

package spanner

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func TestTeamMembershipStatements_CRUD(t *testing.T) {
	ctx := t.Context()
	stmts := testClient.Statements()
	db := newClientDB(testClient.client)

	project := newTestProject(uniqueProjectID(t))
	require.NoError(t, stmts.CreateProject(ctx, project))
	t.Cleanup(func() { _ = stmts.DeleteProjectByID(context.Background(), project.ID) })

	teamID := "team_tm_v2"
	userID := "user_tm_v2"
	schemaURL := "https://schemas.test/team-membership/v1.json"

	require.NoError(t, stmts.CreateJSONSchema(ctx, &domain.JSONSchema{
		ProjectID: project.ID,
		URL:       schemaURL,
		Schema:    []byte("{}"),
	}))
	require.NoError(t, stmts.CreateTeam(ctx, newTestTeam(project.ID, teamID)))

	// Seed the parent user row via DML (integration fixture).
	_, err := db.Update(ctx, buildStatement(
		`INSERT INTO users (project_id, schema_url, id, status, created_at, updated_at) VALUES (@p1, @p2, @p3, @p4, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
		project.ID, schemaURL, userID, domain.UserStatusActive.String(),
	).statement())
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = db.Update(context.Background(), buildStatement(`DELETE FROM team_memberships WHERE project_id = @p1`, project.ID).statement())
		_, _ = db.Update(context.Background(), buildStatement(`DELETE FROM users WHERE project_id = @p1`, project.ID).statement())
	})

	membership := &domain.TeamMembership{
		ProjectID: project.ID,
		TeamID:    teamID,
		UserID:    userID,
		Status:    domain.MembershipStatusActive,
	}
	require.NoError(t, stmts.CreateTeamMembership(ctx, membership))
	assert.False(t, membership.CreatedAt.IsZero())
	assert.False(t, membership.UpdatedAt.IsZero())

	got, err := stmts.GetTeamMembership(ctx, project.ID, teamID, userID)
	require.NoError(t, err)
	assert.Equal(t, domain.MembershipStatusActive, got.Status)
	assert.WithinDuration(t, membership.CreatedAt, got.CreatedAt, time.Second)

	listedByUser, err := stmts.ListTeamMemberships(ctx, &database.ListOptions[domain.TeamMembershipField]{
		Filter: database.And(
			database.Equal(database.Col(domain.TeamMembershipFieldProjectID), project.ID),
			database.Equal(database.Col(domain.TeamMembershipFieldUserID), userID),
		),
	})
	require.NoError(t, err)
	require.Len(t, listedByUser.Items, 1)

	listedByTeam, err := stmts.ListTeamMemberships(ctx, &database.ListOptions[domain.TeamMembershipField]{
		Filter: database.And(
			database.Equal(database.Col(domain.TeamMembershipFieldProjectID), project.ID),
			database.Equal(database.Col(domain.TeamMembershipFieldTeamID), teamID),
		),
	})
	require.NoError(t, err)
	require.Len(t, listedByTeam.Items, 1)

	empty, err := stmts.ListTeamMemberships(ctx, &database.ListOptions[domain.TeamMembershipField]{
		Filter: database.And(
			database.Equal(database.Col(domain.TeamMembershipFieldProjectID), project.ID),
			database.Equal(database.Col(domain.TeamMembershipFieldUserID), "missing-user"),
		),
	})
	require.NoError(t, err)
	assert.Empty(t, empty.Items)

	require.NoError(t, stmts.UpdateTeamMembershipStatus(ctx, project.ID, teamID, userID, domain.MembershipStatusRemoved))
	updated, err := stmts.GetTeamMembership(ctx, project.ID, teamID, userID)
	require.NoError(t, err)
	assert.Equal(t, domain.MembershipStatusRemoved, updated.Status)

	_, err = stmts.GetTeamMembership(ctx, "missing", "missing", "missing")
	require.Error(t, err)
	assert.ErrorIs(t, err, new(database.NoRowFoundError))
}
