package resolver

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/zitadel/nextgen/internal/authz/compiler"
	"github.com/zitadel/nextgen/internal/domain"
)

func TestOracle_HandBuilt(t *testing.T) {
	closure := []compiler.Implication{
		{Source: compiler.Relation{Type: "project", Name: "viewer"}, Implied: compiler.Relation{Type: "project", Name: "viewer"}, Depth: 0},
		{Source: compiler.Relation{Type: "project", Name: "viewer"}, Implied: compiler.Relation{Type: "project", Name: "editor"}, Depth: 1},
		{Source: compiler.Relation{Type: "project", Name: "editor"}, Implied: compiler.Relation{Type: "project", Name: "editor"}, Depth: 0},
		{Source: compiler.Relation{Type: "team", Name: "member"}, Implied: compiler.Relation{Type: "team", Name: "member"}, Depth: 0},
	}
	edges := []compiler.ExpressionEdge{
		{
			Target:   compiler.Relation{Type: "project", Name: "viewer"},
			Kind:     compiler.TermTupleToUserset,
			Source:   compiler.Relation{Type: "team", Name: "member"},
			Tupleset: compiler.Relation{Type: "project", Name: "team"},
			Position: 1,
		},
	}

	t.Run("direct allow", func(t *testing.T) {
		g := Graph{
			Closure: closure,
			Assignments: []*domain.AuthzAssignment{{
				ProjectID: "p1", CatalogID: "c1",
				PrincipalType: domain.AuthzPrincipalTypeUser, PrincipalID: "alice",
				ObjectType: "project", Relation: "viewer",
				ScopeKind: domain.AuthzScopeKindProject,
			}},
		}
		assert.True(t, g.OracleCheck("p1", "p1", domain.AuthzPrincipalTypeUser, "alice", "project", "viewer"))
		assert.True(t, g.OracleCheck("p1", "p1", domain.AuthzPrincipalTypeUser, "alice", "project", "editor"))
		assert.False(t, g.OracleCheck("p1", "p1", domain.AuthzPrincipalTypeUser, "bob", "project", "viewer"))
	})

	t.Run("team expand", func(t *testing.T) {
		g := Graph{
			Closure: closure,
			Assignments: []*domain.AuthzAssignment{{
				ProjectID: "p1", CatalogID: "c1",
				PrincipalType: domain.AuthzPrincipalTypeTeam, PrincipalID: "eng",
				ObjectType: "project", Relation: "viewer",
				ScopeKind: domain.AuthzScopeKindProject,
			}},
			Memberships: []*domain.AuthzMembershipEdge{
				domain.NewUserTeamMembershipEdge("p1", "eng", "alice"),
			},
		}
		assert.True(t, g.OracleCheck("p1", "p1", domain.AuthzPrincipalTypeUser, "alice", "project", "viewer"))
		assert.False(t, g.OracleCheck("p1", "p1", domain.AuthzPrincipalTypeUser, "bob", "project", "viewer"))
	})

	t.Run("ttu", func(t *testing.T) {
		g := Graph{
			Closure: closure,
			Edges:   edges,
			Assignments: []*domain.AuthzAssignment{{
				ProjectID: "p1", CatalogID: "c1",
				PrincipalType: domain.AuthzPrincipalTypeTeam, PrincipalID: "eng",
				ObjectType: "project", Relation: "team",
				ScopeKind: domain.AuthzScopeKindProject,
			}},
			Memberships: []*domain.AuthzMembershipEdge{
				domain.NewUserTeamMembershipEdge("p1", "eng", "alice"),
			},
		}
		assert.True(t, g.OracleCheck("p1", "p1", domain.AuthzPrincipalTypeUser, "alice", "project", "viewer"))
		assert.False(t, g.OracleCheck("p1", "p1", domain.AuthzPrincipalTypeUser, "bob", "project", "viewer"))
	})

	t.Run("ttu malformed tupleset principal type", func(t *testing.T) {
		scoped := &domain.AuthzAssignment{
			ProjectID: "p1", CatalogID: "c1",
			PrincipalType: domain.AuthzPrincipalTypeUser, PrincipalID: "alice",
			ObjectType: "team", Relation: "member",
		}
		scoped.ApplyScope(domain.NewResourceAssignmentScope("alice"))
		g := Graph{
			Closure: closure,
			Edges:   edges,
			Assignments: []*domain.AuthzAssignment{
				{
					ProjectID: "p1", CatalogID: "c1",
					PrincipalType: domain.AuthzPrincipalTypeUser, PrincipalID: "alice",
					ObjectType: "project", Relation: "team",
					ScopeKind: domain.AuthzScopeKindProject,
				},
				scoped,
			},
		}
		assert.False(t, g.OracleCheck("p1", "p1", domain.AuthzPrincipalTypeUser, "alice", "project", "viewer"))
	})

	t.Run("revoked and expired", func(t *testing.T) {
		revoked := time.Now()
		past := time.Now().Add(-time.Hour)
		g := Graph{
			Closure: closure,
			Assignments: []*domain.AuthzAssignment{
				{
					ProjectID: "p1", CatalogID: "c1",
					PrincipalType: domain.AuthzPrincipalTypeUser, PrincipalID: "alice",
					ObjectType: "project", Relation: "viewer",
					ScopeKind: domain.AuthzScopeKindProject,
					RevokedAt: &revoked,
				},
				{
					ProjectID: "p1", CatalogID: "c1",
					PrincipalType: domain.AuthzPrincipalTypeUser, PrincipalID: "bob",
					ObjectType: "project", Relation: "viewer",
					ScopeKind: domain.AuthzScopeKindProject,
					ExpiresAt: &past,
				},
			},
		}
		assert.False(t, g.OracleCheck("p1", "p1", domain.AuthzPrincipalTypeUser, "alice", "project", "viewer"))
		assert.False(t, g.OracleCheck("p1", "p1", domain.AuthzPrincipalTypeUser, "bob", "project", "viewer"))
	})

	t.Run("foothold membership only", func(t *testing.T) {
		g := Graph{
			Memberships: []*domain.AuthzMembershipEdge{
				domain.NewUserTeamMembershipEdge("p1", "eng", "alice"),
			},
		}
		assert.True(t, g.OracleFoothold("p1", domain.AuthzPrincipalTypeUser, "alice"))
		assert.False(t, g.OracleFoothold("p1", domain.AuthzPrincipalTypeUser, "bob"))
	})

	t.Run("sk_team constraint", func(t *testing.T) {
		g := Graph{
			Closure: closure,
			Assignments: []*domain.AuthzAssignment{{
				ProjectID: "p1", CatalogID: "c1",
				PrincipalType: domain.AuthzPrincipalTypeSKTeam, PrincipalID: "sk",
				ObjectType: "project", Relation: "viewer",
				ScopeKind: domain.AuthzScopeKindProject,
			}},
			Memberships: []*domain.AuthzMembershipEdge{
				domain.NewUserTeamMembershipEdge("p1", "eng", "alice"),
			},
			Resources: []*domain.ResourceScope{
				domain.NewUserResourceScope("p1", "alice"),
				domain.NewUserResourceScope("p1", "bob"),
			},
		}
		in := domain.AuthzCheckParams{
			ProjectID: "p1", PrincipalType: domain.AuthzPrincipalTypeSKTeam, PrincipalID: "sk",
			ObjectType: "project", Relation: "viewer",
			ConstraintTeamID: "eng", ResourceID: "alice",
		}
		out := in
		out.ResourceID = "bob"
		assert.True(t, g.OracleCheckParams(in))
		assert.False(t, g.OracleCheckParams(out))
		assert.Equal(t, []string{"alice"}, g.OracleListParams(domain.AuthzListObjectsParams{
			AuthzCheckParams: in,
			ResourceKind:     domain.ResourceKindUser,
		}))
	})

	t.Run("sk_team constraint non-user rsi", func(t *testing.T) {
		eng := "eng"
		other := "other"
		g := Graph{
			Closure: closure,
			Assignments: []*domain.AuthzAssignment{{
				ProjectID: "p1", CatalogID: "c1",
				PrincipalType: domain.AuthzPrincipalTypeSKTeam, PrincipalID: "sk",
				ObjectType: "project", Relation: "viewer",
				ScopeKind: domain.AuthzScopeKindProject,
			}},
			Resources: []*domain.ResourceScope{
				{ResourceID: "brand_in", ResourceKind: domain.ResourceKindBranding, ProjectID: "p1", TeamID: &eng},
				{ResourceID: "brand_out", ResourceKind: domain.ResourceKindBranding, ProjectID: "p1", TeamID: &other},
				{ResourceID: eng, ResourceKind: domain.ResourceKindBranding, ProjectID: "p1", TeamID: &other},
			},
		}
		in := domain.AuthzCheckParams{
			ProjectID: "p1", PrincipalType: domain.AuthzPrincipalTypeSKTeam, PrincipalID: "sk",
			ObjectType: "project", Relation: "viewer",
			ConstraintTeamID: eng, ResourceID: "brand_in", ResourceTeamID: eng,
		}
		out := in
		out.ResourceID = "brand_out"
		out.ResourceTeamID = other
		assert.True(t, g.OracleCheckParams(in))
		assert.False(t, g.OracleCheckParams(out))
		assert.Equal(t, []string{"brand_in"}, g.OracleListParams(domain.AuthzListObjectsParams{
			AuthzCheckParams: in,
			ResourceKind:     domain.ResourceKindBranding,
		}))
	})
}
