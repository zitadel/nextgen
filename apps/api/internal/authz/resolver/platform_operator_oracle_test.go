package resolver

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/zitadel/nextgen/internal/authz/compiler"
	"github.com/zitadel/nextgen/internal/authz/openfga"
	"github.com/zitadel/nextgen/internal/domain"
)

// systemCatalogModel is the system catalog as the migrations seed it, ADR 075's
// platform operator included. Compiling it here keeps the oracle honest about
// the edge and closure rows the platform operator path reads.
const systemCatalogModel = `model
  schema 1.1

type user

type team
  relations
    define member: [user]

type platform
  relations
    define operator: [user]

type project
  relations
    define team: [team]
    define platform: [platform]
    define admin: [user, team#member] or member from team or operator from platform
    define editor: [user, team#member] or admin
    define viewer: [user, team#member] or editor
`

func TestOracle_PlatformOperator(t *testing.T) {
	model, err := openfga.ParseDSL(systemCatalogModel)
	require.NoError(t, err)
	out, err := compiler.Compile(model)
	require.NoError(t, err)

	const platform, customer = "proj_platform", "proj_customer"
	operator := domain.NewPlatformOperatorAssignment(platform, "user_op")
	active := map[UserKey]bool{{ProjectID: platform, UserID: "user_op"}: true}
	graph := func(assignments ...*domain.AuthzAssignment) Graph {
		g := GraphFromPersisted(out.Catalog.Persisted())
		g.Assignments = assignments
		g.ActiveUsers = active
		g.Resources = []*domain.ResourceScope{
			domain.NewUserResourceScope(customer, "user_a"),
			domain.NewUserResourceScope(customer, "user_b"),
			domain.NewUserResourceScope(platform, "user_op"),
		}
		return g
	}
	ask := func(userID, relation string) domain.AuthzPlatformCheckParams {
		return domain.AuthzPlatformCheckParams{
			PlatformProjectID: platform, UserID: userID, ObjectType: "project", Relation: relation,
		}
	}

	t.Run("an operator administers, edits and views every project", func(t *testing.T) {
		g := graph(operator)
		for _, relation := range []string{"admin", "editor", "viewer"} {
			assert.True(t, g.OraclePlatformOperator(ask("user_op", relation)), relation)
		}
	})

	t.Run("it maps onto project relations only", func(t *testing.T) {
		g := graph(operator)
		assert.False(t, g.OraclePlatformOperator(domain.AuthzPlatformCheckParams{
			PlatformProjectID: platform, UserID: "user_op", ObjectType: "team", Relation: "member",
		}))
	})

	t.Run("nobody else holds it", func(t *testing.T) {
		g := graph(operator)
		g.ActiveUsers[UserKey{ProjectID: platform, UserID: "user_other"}] = true
		assert.False(t, g.OraclePlatformOperator(ask("user_other", "viewer")))
	})

	t.Run("the assignment must sit in the platform project", func(t *testing.T) {
		elsewhere := domain.NewPlatformOperatorAssignment(customer, "user_op")
		g := graph(elsewhere)
		assert.False(t, g.OraclePlatformOperator(ask("user_op", "viewer")))
	})

	t.Run("a revoked or expired assignment does not count", func(t *testing.T) {
		past := time.Now().Add(-time.Minute)
		revoked := domain.NewPlatformOperatorAssignment(platform, "user_op")
		revoked.RevokedAt = &past
		expired := domain.NewPlatformOperatorAssignment(platform, "user_op")
		expired.ExpiresAt = &past
		for _, a := range []*domain.AuthzAssignment{revoked, expired} {
			g := graph(a)
			assert.False(t, g.OraclePlatformOperator(ask("user_op", "viewer")))
		}
	})

	t.Run("an inactive operator does not count", func(t *testing.T) {
		g := graph(operator)
		g.ActiveUsers = nil
		assert.False(t, g.OraclePlatformOperator(ask("user_op", "viewer")))
	})

	t.Run("a team cannot carry it", func(t *testing.T) {
		team := domain.NewPlatformOperatorAssignment(platform, "team_ops")
		team.PrincipalType = domain.AuthzPrincipalTypeTeam
		g := graph(team)
		g.Memberships = []*domain.AuthzMembershipEdge{domain.NewUserTeamMembershipEdge(platform, "team_ops", "user_op")}
		assert.False(t, g.OraclePlatformOperator(ask("user_op", "viewer")))
	})

	t.Run("an operator lists every row of a project", func(t *testing.T) {
		g := graph(operator)
		params := domain.AuthzListObjectsParams{
			AuthzCheckParams: domain.AuthzCheckParams{
				ProjectID: customer, PrincipalHomeProjectID: platform, PlatformProjectID: platform,
				PrincipalType: domain.AuthzPrincipalTypeUser, PrincipalID: "user_op",
				ObjectType: "project", Relation: "viewer",
			},
			ResourceKind: domain.ResourceKindUser,
		}
		assert.ElementsMatch(t, []string{"user_a", "user_b"}, g.OracleListParams(params))

		params.PlatformProjectID = ""
		assert.Empty(t, g.OracleListParams(params), "without the platform project the operator path is closed")
	})
}
