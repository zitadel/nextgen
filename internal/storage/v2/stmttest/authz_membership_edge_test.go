//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

func edgeFilter(projectID string, setType domain.AuthzSetType, setID string, memberType domain.AuthzMemberType, memberID string) database.Filter[domain.AuthzMembershipEdgeField] {
	return database.And(
		database.Equal(database.Col(domain.AuthzMembershipEdgeFieldProjectID), projectID),
		database.Equal(database.Col(domain.AuthzMembershipEdgeFieldSetType), setType),
		database.Equal(database.Col(domain.AuthzMembershipEdgeFieldSetID), setID),
		database.Equal(database.Col(domain.AuthzMembershipEdgeFieldMemberType), memberType),
		database.Equal(database.Col(domain.AuthzMembershipEdgeFieldMemberID), memberID),
	)
}

func TestAuthzMembershipEdgeStatements_UpsertGetDelete(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)
		teamID := "team-edge-" + uniqueSuffix(t)
		userID := "usr-edge-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamID)))
		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "Edge User")))

		edge := &domain.AuthzMembershipEdge{
			ProjectID:  projectID,
			MemberType: domain.AuthzMemberTypeUser,
			MemberID:   userID,
			SetType:    domain.AuthzSetTypeTeam,
			SetID:      teamID,
		}
		require.NoError(t, d.stmts.UpsertAuthzMembershipEdge(t.Context(), edge))
		assert.False(t, edge.CreatedAt.IsZero())

		got, err := d.stmts.GetAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdgeKey(projectID, teamID, userID))
		require.NoError(t, err)
		assert.Equal(t, userID, got.MemberID)

		require.NoError(t, d.stmts.UpsertAuthzMembershipEdge(t.Context(), edge))

		listed, err := d.stmts.ListAuthzMembershipEdgesByMember(t.Context(), projectID, domain.AuthzMemberTypeUser, userID)
		require.NoError(t, err)
		require.Len(t, listed, 1)
		assert.Equal(t, teamID, listed[0].SetID)

		require.NoError(t, d.stmts.DeleteAuthzMembershipEdges(t.Context(),
			edgeFilter(projectID, domain.AuthzSetTypeTeam, teamID, domain.AuthzMemberTypeUser, userID)))
		_, err = d.stmts.GetAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdgeKey(projectID, teamID, userID))
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
		require.NoError(t, d.stmts.DeleteAuthzMembershipEdges(t.Context(),
			edgeFilter(projectID, domain.AuthzSetTypeTeam, teamID, domain.AuthzMemberTypeUser, userID)))
	})
}

func TestAuthzMembershipEdgeStatements_MissingSetReturnsForeignKeyError(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		err := d.stmts.UpsertAuthzMembershipEdge(t.Context(), &domain.AuthzMembershipEdge{
			ProjectID:  projectID,
			MemberType: domain.AuthzMemberTypeUser,
			MemberID:   "usr-missing-set-" + uniqueSuffix(t),
			SetType:    domain.AuthzSetTypeTeam,
			SetID:      "team-does-not-exist-" + uniqueSuffix(t),
		})
		assert.ErrorIs(t, err, new(database.ForeignKeyError))
	})
}

func TestAuthzMembershipEdgeStatements_DeleteByMemberAndSet(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)
		teamA := "team-a-" + uniqueSuffix(t)
		teamB := "team-b-" + uniqueSuffix(t)
		userID := "usr-edge-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamA)))
		require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamB)))
		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "Edge User")))

		for _, teamID := range []string{teamA, teamB} {
			require.NoError(t, d.stmts.UpsertAuthzMembershipEdge(t.Context(), &domain.AuthzMembershipEdge{
				ProjectID: projectID, MemberType: domain.AuthzMemberTypeUser, MemberID: userID,
				SetType: domain.AuthzSetTypeTeam, SetID: teamID,
			}))
		}

		require.NoError(t, d.stmts.DeleteAuthzMembershipEdges(t.Context(), database.And(
			database.Equal(database.Col(domain.AuthzMembershipEdgeFieldProjectID), projectID),
			database.Equal(database.Col(domain.AuthzMembershipEdgeFieldSetType), domain.AuthzSetTypeTeam),
			database.Equal(database.Col(domain.AuthzMembershipEdgeFieldSetID), teamA),
		)))
		_, err := d.stmts.GetAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdgeKey(projectID, teamA, userID))
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
		_, err = d.stmts.GetAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdgeKey(projectID, teamB, userID))
		require.NoError(t, err)

		require.NoError(t, d.stmts.DeleteAuthzMembershipEdges(t.Context(), database.And(
			database.Equal(database.Col(domain.AuthzMembershipEdgeFieldProjectID), projectID),
			database.Equal(database.Col(domain.AuthzMembershipEdgeFieldMemberType), domain.AuthzMemberTypeUser),
			database.Equal(database.Col(domain.AuthzMembershipEdgeFieldMemberID), userID),
		)))
		_, err = d.stmts.GetAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdgeKey(projectID, teamB, userID))
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}
