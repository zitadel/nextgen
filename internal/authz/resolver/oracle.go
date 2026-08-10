package resolver

import (
	"time"

	"github.com/zitadel/nextgen/internal/authz/compiler"
	"github.com/zitadel/nextgen/internal/domain"
)

// Graph is an in-memory authz fact set for the L4 oracle.
type Graph struct {
	Closure     []compiler.Implication
	Edges       []compiler.ExpressionEdge
	Assignments []*domain.AuthzAssignment
	Memberships []*domain.AuthzMembershipEdge
	Resources   []*domain.ResourceScope
}

// OracleCheck applies MVP rules: direct+closure, team membership expand, bounded TTU.
func (g *Graph) OracleCheck(projectID, principalHomeProjectID string, principalType domain.AuthzPrincipalType, principalID, objectType, relation string) bool {
	if principalHomeProjectID == "" {
		principalHomeProjectID = projectID
	}
	now := time.Now()
	if g.closureAllowsScoped(projectID, principalHomeProjectID, principalType, principalID, objectType, relation, domain.AuthzScopeKindProject, "", now) {
		return true
	}
	return g.ttuAllows(projectID, principalHomeProjectID, principalType, principalID, objectType, relation, now)
}

// OracleList returns resource ids of kind that OracleCheck would authorize under
// project / team / resource scoped grants (mirrors ListAuthzObjectIDs).
func (g *Graph) OracleList(projectID, principalHomeProjectID string, principalType domain.AuthzPrincipalType, principalID string, kind domain.ResourceKind, objectType, relation string) []string {
	if principalHomeProjectID == "" {
		principalHomeProjectID = projectID
	}
	now := time.Now()
	projectWide := g.closureAllowsScoped(projectID, principalHomeProjectID, principalType, principalID, objectType, relation, domain.AuthzScopeKindProject, "", now) ||
		g.ttuAllows(projectID, principalHomeProjectID, principalType, principalID, objectType, relation, now)

	out := make([]string, 0)
	seen := map[string]struct{}{}
	for _, r := range g.Resources {
		if r.ProjectID != projectID || r.ResourceKind != kind {
			continue
		}
		allow := projectWide
		if !allow && r.TeamID != nil {
			allow = g.closureAllowsScoped(projectID, principalHomeProjectID, principalType, principalID, objectType, relation, domain.AuthzScopeKindTeam, *r.TeamID, now)
		}
		if !allow {
			allow = g.closureAllowsScoped(projectID, principalHomeProjectID, principalType, principalID, objectType, relation, domain.AuthzScopeKindResource, r.ResourceID, now)
		}
		if allow {
			if _, ok := seen[r.ResourceID]; !ok {
				seen[r.ResourceID] = struct{}{}
				out = append(out, r.ResourceID)
			}
		}
	}
	return out
}

// OracleFoothold mirrors HasAuthzProjectFoothold.
func (g *Graph) OracleFoothold(projectID string, principalType domain.AuthzPrincipalType, principalID string) bool {
	now := time.Now()
	for _, a := range g.Assignments {
		if a.ProjectID != projectID || !assignmentActive(a, now) {
			continue
		}
		if g.principalMatches(projectID, principalType, principalID, a) {
			return true
		}
	}
	if principalType == domain.AuthzPrincipalTypeUser {
		for _, e := range g.Memberships {
			if e.ProjectID == projectID && e.MemberType == domain.AuthzMemberTypeUser && e.MemberID == principalID {
				return true
			}
		}
	}
	return false
}

func (g *Graph) closureAllowsScoped(projectID, home string, pType domain.AuthzPrincipalType, pID, objectType, relation string, scope domain.AuthzScopeKind, scopeID string, now time.Time) bool {
	for _, a := range g.Assignments {
		if a.ProjectID != projectID || !assignmentActive(a, now) {
			continue
		}
		if a.ScopeKind != scope {
			continue
		}
		switch scope {
		case domain.AuthzScopeKindTeam:
			if a.ScopeTeamID == nil || *a.ScopeTeamID != scopeID {
				continue
			}
		case domain.AuthzScopeKindResource:
			if a.ScopeResourceID == nil || *a.ScopeResourceID != scopeID {
				continue
			}
		}
		if !g.implies(a.ObjectType, a.Relation, objectType, relation) {
			continue
		}
		if g.principalMatches(home, pType, pID, a) {
			return true
		}
	}
	return false
}

func (g *Graph) ttuAllows(projectID, home string, pType domain.AuthzPrincipalType, pID, objectType, relation string, now time.Time) bool {
	for _, edge := range g.Edges {
		if edge.Kind != compiler.TermTupleToUserset {
			continue
		}
		if edge.Target.Type != objectType || edge.Target.Name != relation {
			continue
		}
		for _, ts := range g.Assignments {
			if ts.ProjectID != projectID || !assignmentActive(ts, now) {
				continue
			}
			if ts.ObjectType != edge.Tupleset.Type || ts.Relation != edge.Tupleset.Name {
				continue
			}
			// Membership path for team.member source.
			if edge.Source.Type == "team" && edge.Source.Name == "member" &&
				ts.PrincipalType == domain.AuthzPrincipalTypeTeam &&
				pType == domain.AuthzPrincipalTypeUser &&
				g.isMember(home, ts.PrincipalID, pID) {
				return true
			}
			// Assignment+closure path on intermediate.
			for _, a := range g.Assignments {
				if a.ProjectID != projectID || !assignmentActive(a, now) {
					continue
				}
				if !g.implies(a.ObjectType, a.Relation, edge.Source.Type, edge.Source.Name) {
					continue
				}
				if !g.principalMatches(home, pType, pID, a) {
					continue
				}
				switch a.ScopeKind {
				case domain.AuthzScopeKindTeam:
					if a.ScopeTeamID != nil && *a.ScopeTeamID == ts.PrincipalID {
						return true
					}
				case domain.AuthzScopeKindResource:
					if a.ScopeResourceID != nil && *a.ScopeResourceID == ts.PrincipalID {
						return true
					}
				case domain.AuthzScopeKindProject:
					if a.ObjectType == edge.Source.Type {
						return true
					}
				}
			}
		}
	}
	return false
}

func (g *Graph) implies(fromType, fromRel, toType, toRel string) bool {
	for _, impl := range g.Closure {
		if impl.Source.Type == fromType && impl.Source.Name == fromRel &&
			impl.Implied.Type == toType && impl.Implied.Name == toRel {
			return true
		}
	}
	// Reflexive fallback when closure omitted in hand tests.
	return fromType == toType && fromRel == toRel
}

func (g *Graph) principalMatches(home string, pType domain.AuthzPrincipalType, pID string, a *domain.AuthzAssignment) bool {
	if a.PrincipalType == pType && a.PrincipalID == pID {
		return true
	}
	if pType == domain.AuthzPrincipalTypeUser && a.PrincipalType == domain.AuthzPrincipalTypeTeam {
		return g.isMember(home, a.PrincipalID, pID)
	}
	return false
}

func (g *Graph) isMember(projectID, teamID, userID string) bool {
	for _, e := range g.Memberships {
		if e.ProjectID == projectID &&
			e.SetType == domain.AuthzSetTypeTeam && e.SetID == teamID &&
			e.MemberType == domain.AuthzMemberTypeUser && e.MemberID == userID {
			return true
		}
	}
	return false
}

func assignmentActive(a *domain.AuthzAssignment, now time.Time) bool {
	if a.RevokedAt != nil {
		return false
	}
	if a.ExpiresAt != nil && !a.ExpiresAt.After(now) {
		return false
	}
	return true
}

// GraphFromPersisted builds an oracle graph catalog fragment from compiler output.
func GraphFromPersisted(catalog compiler.PersistedCatalog) Graph {
	return Graph{
		Closure: catalog.Closure,
		Edges:   catalog.ExpressionEdges,
	}
}
