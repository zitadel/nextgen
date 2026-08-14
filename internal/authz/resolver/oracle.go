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
	home := principalHomeOrProject(principalHomeProjectID, projectID)
	now := time.Now()
	if g.closureAllowsScoped(projectID, home, principalType, principalID, objectType, relation, domain.AuthzScopeKindProject, "", now) {
		return true
	}
	return g.ttuAllows(projectID, home, principalType, principalID, objectType, relation, now)
}

// OracleCheckParams applies OracleCheck, optional team/resource-scoped grant
// arms (by-id Check), then the sk_team_ team constraint.
func (g *Graph) OracleCheckParams(p domain.AuthzCheckParams) bool {
	home := p.HomeProjectID()
	now := time.Now()
	allowed := g.OracleCheck(p.ProjectID, home, p.PrincipalType, p.PrincipalID, p.ObjectType, p.Relation)
	if !allowed && p.ResourceTeamID != "" {
		allowed = g.closureAllowsScoped(p.ProjectID, home, p.PrincipalType, p.PrincipalID, p.ObjectType, p.Relation, domain.AuthzScopeKindTeam, p.ResourceTeamID, now)
	}
	if !allowed && p.ResourceID != "" {
		allowed = g.closureAllowsScoped(p.ProjectID, home, p.PrincipalType, p.PrincipalID, p.ObjectType, p.Relation, domain.AuthzScopeKindResource, p.ResourceID, now)
	}
	if !allowed {
		return false
	}
	return g.constraintTeamAllows(p)
}

// OracleList returns resource ids of kind authorized under project / team / resource scopes.
func (g *Graph) OracleList(projectID, principalHomeProjectID string, principalType domain.AuthzPrincipalType, principalID string, kind domain.ResourceKind, objectType, relation string) []string {
	home := principalHomeOrProject(principalHomeProjectID, projectID)
	now := time.Now()
	projectWide := g.closureAllowsScoped(projectID, home, principalType, principalID, objectType, relation, domain.AuthzScopeKindProject, "", now) ||
		g.ttuAllows(projectID, home, principalType, principalID, objectType, relation, now)

	out := make([]string, 0)
	seen := map[string]struct{}{}
	for _, r := range g.Resources {
		if r.ProjectID != projectID || r.ResourceKind != kind {
			continue
		}
		if !projectWide &&
			!(r.TeamID != nil && g.closureAllowsScoped(projectID, home, principalType, principalID, objectType, relation, domain.AuthzScopeKindTeam, *r.TeamID, now)) &&
			!g.closureAllowsScoped(projectID, home, principalType, principalID, objectType, relation, domain.AuthzScopeKindResource, r.ResourceID, now) {
			continue
		}
		if _, ok := seen[r.ResourceID]; ok {
			continue
		}
		seen[r.ResourceID] = struct{}{}
		out = append(out, r.ResourceID)
	}
	return out
}

// OracleListParams applies OracleList then the sk_team_ team constraint.
func (g *Graph) OracleListParams(p domain.AuthzListObjectsParams) []string {
	ids := g.OracleList(p.ProjectID, p.HomeProjectID(), p.PrincipalType, p.PrincipalID, p.ResourceKind, p.ObjectType, p.Relation)
	if p.ConstraintTeamID == "" {
		return ids
	}
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if g.listedObjectInConstraintTeam(p, id) {
			out = append(out, id)
		}
	}
	return out
}

func (g *Graph) constraintTeamAllows(p domain.AuthzCheckParams) bool {
	if p.ConstraintTeamID == "" || p.ResourceID == "" {
		return true
	}
	if p.ResourceID == p.ConstraintTeamID {
		return true
	}
	return g.isMember(p.ProjectID, p.ConstraintTeamID, p.ResourceID)
}

func (g *Graph) listedObjectInConstraintTeam(p domain.AuthzListObjectsParams, id string) bool {
	switch p.ResourceKind {
	case domain.ResourceKindUser:
		return g.isMember(p.ProjectID, p.ConstraintTeamID, id)
	case domain.ResourceKindTeam:
		return id == p.ConstraintTeamID
	default:
		if id == p.ConstraintTeamID {
			return true
		}
		for _, r := range g.Resources {
			if r.ResourceID == id && r.TeamID != nil && *r.TeamID == p.ConstraintTeamID {
				return true
			}
		}
		return false
	}
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
	if principalType != domain.AuthzPrincipalTypeUser {
		return false
	}
	for _, e := range g.Memberships {
		if e.ProjectID == projectID && e.MemberType == domain.AuthzMemberTypeUser && e.MemberID == principalID {
			return true
		}
	}
	return false
}

func (g *Graph) closureAllowsScoped(projectID, home string, pType domain.AuthzPrincipalType, pID, objectType, relation string, scope domain.AuthzScopeKind, scopeID string, now time.Time) bool {
	for _, a := range g.Assignments {
		if a.ProjectID != projectID || !assignmentActive(a, now) || a.ScopeKind != scope {
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
		if edge.Kind != compiler.TermTupleToUserset ||
			edge.Target.Type != objectType || edge.Target.Name != relation {
			continue
		}
		for _, ts := range g.Assignments {
			if ts.ProjectID != projectID || !assignmentActive(ts, now) ||
				ts.ObjectType != edge.Tupleset.Type || ts.Relation != edge.Tupleset.Name ||
				ts.PrincipalType.String() != edge.Source.Type {
				continue
			}
			if edge.Source.Type == "team" && edge.Source.Name == "member" &&
				ts.PrincipalType == domain.AuthzPrincipalTypeTeam &&
				pType == domain.AuthzPrincipalTypeUser &&
				g.isMember(home, ts.PrincipalID, pID) {
				return true
			}
			for _, a := range g.Assignments {
				if a.ProjectID != projectID || !assignmentActive(a, now) ||
					!g.implies(a.ObjectType, a.Relation, edge.Source.Type, edge.Source.Name) ||
					!g.principalMatches(home, pType, pID, a) {
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

func principalHomeOrProject(home, projectID string) string {
	if home != "" {
		return home
	}
	return projectID
}

// GraphFromPersisted builds an oracle graph catalog fragment from compiler output.
func GraphFromPersisted(catalog compiler.PersistedCatalog) Graph {
	return Graph{
		Closure: catalog.Closure,
		Edges:   catalog.ExpressionEdges,
	}
}
