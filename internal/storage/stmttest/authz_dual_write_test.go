//go:build postgres_integration || spanner_integration || sqlite_integration

package stmttest

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func TestUserStatements_CreateDelete_DualWriteResourceScope(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)
		teamID := "team-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamID)))

		userID := "usr-" + uniqueSuffix(t)
		user := newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "Dual User")
		user.InitialMembershipTeamID = &teamID
		require.NoError(t, d.stmts.CreateUser(t.Context(), user))

		scope, err := d.stmts.GetResourceScope(t.Context(), userID)
		require.NoError(t, err)
		assert.Equal(t, domain.ResourceKindUser, scope.ResourceKind)
		assert.Nil(t, scope.TeamID)

		edge, err := d.stmts.GetAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdgeKey(projectID, teamID, userID))
		require.NoError(t, err)
		assert.Equal(t, userID, edge.MemberID)

		require.NoError(t, d.stmts.DeleteUserByID(t.Context(), projectID, userID))
		_, err = d.stmts.GetResourceScope(t.Context(), userID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
		_, err = d.stmts.GetAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdgeKey(projectID, teamID, userID))
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

func TestUserStatements_Deactivate_clearsMembershipEdges(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)
		teamID := "team-" + uniqueSuffix(t)
		userID := "usr-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamID)))
		user := newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "User")
		user.InitialMembershipTeamID = &teamID
		require.NoError(t, d.stmts.CreateUser(t.Context(), user))

		_, err := d.stmts.GetAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdgeKey(projectID, teamID, userID))
		require.NoError(t, err)

		require.NoError(t, d.stmts.DeactivateUser(t.Context(), projectID, userID))
		_, err = d.stmts.GetAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdgeKey(projectID, teamID, userID))
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		scope, err := d.stmts.GetResourceScope(t.Context(), userID)
		require.NoError(t, err)
		assert.Equal(t, domain.ResourceKindUser, scope.ResourceKind)
	})
}

func TestTeamStatements_Deactivate_clearsMembershipEdges(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)
		teamID := "team-" + uniqueSuffix(t)
		userID := "usr-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamID)))
		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "User")))
		require.NoError(t, d.stmts.CreateTeamMembership(t.Context(), &domain.TeamMembership{
			ProjectID: projectID, TeamID: teamID, UserID: userID, Status: domain.MembershipStatusActive,
		}))

		_, err := d.stmts.GetAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdgeKey(projectID, teamID, userID))
		require.NoError(t, err)

		_, err := d.stmts.DeactivateTeam(t.Context(), projectID, teamID)
		require.NoError(t, err)
		_, err = d.stmts.GetAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdgeKey(projectID, teamID, userID))
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		scope, err := d.stmts.GetResourceScope(t.Context(), teamID)
		require.NoError(t, err)
		assert.Equal(t, domain.ResourceKindTeam, scope.ResourceKind)
	})
}

func TestTeamMembershipStatements_DualWrite_StatusVariants(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID, schemaURL := ensureUserTestProject(t, d.stmts)
		teamID := "team-tm-" + uniqueSuffix(t)
		userID := "usr-tm-" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateTeam(t.Context(), newTestTeam(projectID, teamID)))
		require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, userID, userID+"@example.com", "Member"))

		require.NoError(t, err)
		t.Run("active create writes edge; removed clears edge", func(t *testing.T) {
			require.NoError(t, d.stmts.CreateTeamMembership(t.Context(), &domain.TeamMembership{
				ProjectID: projectID, TeamID: teamID, UserID: userID, Status: domain.MembershipStatusActive,
			}))
			_, err := d.stmts.GetAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdgeKey(projectID, teamID, userID))
			require.NoError(t, err)

			require.NoError(t, d.stmts.UpdateTeamMembershipStatus(t.Context(), projectID, teamID, userID, domain.MembershipStatusRemoved))
			_, err = d.stmts.GetAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdgeKey(projectID, teamID, userID))
			assert.ErrorIs(t, err, new(database.NoRowFoundError))
		})

		t.Run("pending has no edge; active writes; inactive clears but keeps assignment", func(t *testing.T) {
			user2 := "usr-tm2-" + uniqueSuffix(t)
			require.NoError(t, d.stmts.CreateUser(t.Context(), newTestUser(t, projectID, schemaURL, user2, user2+"@example.com", "Member2")))

			require.NoError(t, d.stmts.CreateTeamMembership(t.Context(), &domain.TeamMembership{
				ProjectID: projectID, TeamID: teamID, UserID: user2, Status: domain.MembershipStatusPending,
			}))
			_, err := d.stmts.GetAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdgeKey(projectID, teamID, user2))
			assert.ErrorIs(t, err, new(database.NoRowFoundError))

			require.NoError(t, d.stmts.UpdateTeamMembershipStatus(t.Context(), projectID, teamID, user2, domain.MembershipStatusActive))
			_, err = d.stmts.GetAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdgeKey(projectID, teamID, user2))
			require.NoError(t, err)

			asgn := newTestAssignment(projectID, "asgn-"+uniqueSuffix(t), domain.AuthzPrincipalTypeTeam, teamID, "project", "viewer", domain.NewProjectAssignmentScope())
			require.NoError(t, d.stmts.CreateAuthzAssignment(t.Context(), asgn))

			require.NoError(t, d.stmts.UpdateTeamMembershipStatus(t.Context(), projectID, teamID, user2, domain.MembershipStatusInactive))
			_, err = d.stmts.GetAuthzMembershipEdge(t.Context(), domain.NewUserTeamMembershipEdgeKey(projectID, teamID, user2))
			assert.ErrorIs(t, err, new(database.NoRowFoundError))

			gotAsgn, err := d.stmts.GetAuthzAssignment(t.Context(), projectID, asgn.ID)
			require.NoError(t, err)
			assert.Nil(t, gotAsgn.RevokedAt)
		})
	})
}

func TestJSONSchemaStatements_CreateDelete_DualWriteResourceScope(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		schemaURL := "sch_" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateJSONSchema(t.Context(), &domain.JSONSchema{
			ProjectID: projectID,
			URL:       schemaURL,
			Schema:    []byte(`{"type":"object"}`),
		}))

		scope, err := d.stmts.GetResourceScopeInProject(t.Context(), domain.ResourceKindSchema, projectID, schemaURL)
		require.NoError(t, err)
		assert.Equal(t, domain.ResourceKindSchema, scope.ResourceKind)
		assert.Equal(t, projectID, scope.ProjectID)
		assert.Nil(t, scope.TeamID)

		otherProjectID := ensureProject(t, d.stmts)
		require.NoError(t, d.stmts.DeleteJSONSchemaByID(t.Context(), otherProjectID, schemaURL))
		scope, err = d.stmts.GetResourceScopeInProject(t.Context(), domain.ResourceKindSchema, projectID, schemaURL)
		require.NoError(t, err)
		assert.Equal(t, projectID, scope.ProjectID)

		require.NoError(t, d.stmts.DeleteJSONSchemaByID(t.Context(), projectID, schemaURL))
		_, err = d.stmts.GetResourceScopeInProject(t.Context(), domain.ResourceKindSchema, projectID, schemaURL)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

func TestJSONSchemaStatements_SharedPublicURL_ScopedPerProject(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		sharedURL := "https://example.com/schemas/shared-user.json"
		projectA := ensureProject(t, d.stmts)
		projectB := ensureProject(t, d.stmts)

		require.NoError(t, d.stmts.CreateJSONSchema(t.Context(), &domain.JSONSchema{
			ProjectID: projectA,
			URL:       sharedURL,
			Schema:    []byte(`{"type":"object","$id":"` + sharedURL + `"}`),
		}))
		require.NoError(t, d.stmts.CreateJSONSchema(t.Context(), &domain.JSONSchema{
			ProjectID: projectB,
			URL:       sharedURL,
			Schema:    []byte(`{"type":"object","$id":"` + sharedURL + `"}`),
		}))

		scopeA, err := d.stmts.GetResourceScopeInProject(t.Context(), domain.ResourceKindSchema, projectA, sharedURL)
		require.NoError(t, err)
		assert.Equal(t, projectA, scopeA.ProjectID)

		scopeB, err := d.stmts.GetResourceScopeInProject(t.Context(), domain.ResourceKindSchema, projectB, sharedURL)
		require.NoError(t, err)
		assert.Equal(t, projectB, scopeB.ProjectID)

		elsewhere, err := d.stmts.ExistsResourceScopeElsewhere(t.Context(), domain.ResourceKindSchema, sharedURL, "proj_caller_absent")
		require.NoError(t, err)
		assert.True(t, elsewhere)

		elsewhere, err = d.stmts.ExistsResourceScopeElsewhere(t.Context(), domain.ResourceKindSchema, sharedURL, projectA)
		require.NoError(t, err)
		assert.True(t, elsewhere, "project B still holds the URL")

		scopeByID, err := d.stmts.GetResourceScopeByIDInProject(t.Context(), projectA, sharedURL)
		require.NoError(t, err)
		assert.Equal(t, domain.ResourceKindSchema, scopeByID.ResourceKind)

		require.NoError(t, d.stmts.DeleteJSONSchemaByID(t.Context(), projectB, sharedURL))
		_, err = d.stmts.GetResourceScopeInProject(t.Context(), domain.ResourceKindSchema, projectB, sharedURL)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))

		scopeA, err = d.stmts.GetResourceScopeInProject(t.Context(), domain.ResourceKindSchema, projectA, sharedURL)
		require.NoError(t, err)
		assert.Equal(t, projectA, scopeA.ProjectID)

		elsewhere, err = d.stmts.ExistsResourceScopeElsewhere(t.Context(), domain.ResourceKindSchema, sharedURL, projectA)
		require.NoError(t, err)
		assert.False(t, elsewhere, "only project A remains")
	})
}

func TestBrandingStatements_Create_DualWriteResourceScope(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		brandingID := "brnd_" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateBranding(t.Context(), sampleBranding(projectID, brandingID)))

		scope, err := d.stmts.GetResourceScope(t.Context(), brandingID)
		require.NoError(t, err)
		assert.Equal(t, domain.ResourceKindBranding, scope.ResourceKind)
		assert.Equal(t, projectID, scope.ProjectID)
		assert.Nil(t, scope.TeamID)
	})
}

func TestFlowDefinitionStatements_CreateDelete_DualWriteResourceScope(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		flowID := "flowdef_" + uniqueSuffix(t)
		require.NoError(t, d.stmts.CreateFlowDefinition(t.Context(), sampleFlowDefinition(projectID, flowID, "Default Login")))

		scope, err := d.stmts.GetResourceScope(t.Context(), flowID)
		require.NoError(t, err)
		assert.Equal(t, domain.ResourceKindFlowDefinition, scope.ResourceKind)
		assert.Equal(t, projectID, scope.ProjectID)

		otherProjectID := ensureProject(t, d.stmts)
		require.NoError(t, d.stmts.DeleteFlowDefinitionByID(t.Context(), otherProjectID, flowID))
		scope, err = d.stmts.GetResourceScope(t.Context(), flowID)
		require.NoError(t, err)
		assert.Equal(t, projectID, scope.ProjectID)

		require.NoError(t, d.stmts.DeleteFlowDefinitionByID(t.Context(), projectID, flowID))
		_, err = d.stmts.GetResourceScope(t.Context(), flowID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}

func TestSessionStatements_CreateDelete_DualWriteResourceScope(t *testing.T) {
	forEachDialect(t, func(t *testing.T, d dialect) {
		projectID := ensureProject(t, d.stmts)
		session, err := domain.NewSession(projectID, nil)
		require.NoError(t, err)
		require.NoError(t, d.stmts.CreateSession(t.Context(), session))
		require.NotEmpty(t, session.ID)

		scope, err := d.stmts.GetResourceScope(t.Context(), session.ID)
		require.NoError(t, err)
		assert.Equal(t, domain.ResourceKindSession, scope.ResourceKind)
		assert.Equal(t, projectID, scope.ProjectID)

		otherProjectID := ensureProject(t, d.stmts)
		err = d.stmts.DeleteSessionByID(t.Context(), otherProjectID, session.ID)
		assert.ErrorIs(t, err, domain.ErrSessionNotFound())
		scope, err = d.stmts.GetResourceScope(t.Context(), session.ID)
		require.NoError(t, err)
		assert.Equal(t, projectID, scope.ProjectID)

		require.NoError(t, d.stmts.DeleteSessionByID(t.Context(), projectID, session.ID))
		_, err = d.stmts.GetResourceScope(t.Context(), session.ID)
		assert.ErrorIs(t, err, new(database.NoRowFoundError))
	})
}
