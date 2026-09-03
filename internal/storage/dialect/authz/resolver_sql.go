package authz

import (
	"github.com/zitadel/nextgen/internal/domain"
)

// ArgWriter is satisfied by each dialect's statementCompiler.
type ArgWriter interface {
	WriteString(string)
	WriteArg(any)
}

// Env adapts shared resolver SQL to one dialect (schema prefix + clock).
type Env struct {
	// Schema is table qualifier including trailing dot, or empty (e.g. "zitadel_nextgen.").
	Schema string
	// Now emits the dialect clock compared to expires_at.
	Now func(ArgWriter)
}

func writeTable(w ArgWriter, env Env, name string) {
	w.WriteString(env.Schema)
	w.WriteString(name)
}

func writeExpiresActive(w ArgWriter, env Env, alias string) {
	w.WriteString("(")
	w.WriteString(alias)
	w.WriteString(".expires_at IS NULL OR ")
	w.WriteString(alias)
	w.WriteString(".expires_at > ")
	env.Now(w)
	w.WriteString(")")
}

// WriteActiveSystemCatalogID emits SELECT id for the active system catalog.
func WriteActiveSystemCatalogID(w ArgWriter, env Env) {
	w.WriteString(`
SELECT id
FROM `)
	writeTable(w, env, "authz_catalogs")
	w.WriteString(`
WHERE catalog_kind = `)
	w.WriteArg(domain.AuthzCatalogKindSystem.String())
	w.WriteString(` AND owner_id = `)
	w.WriteArg(domain.SystemCatalogOwnerID)
	w.WriteString(` AND status = `)
	w.WriteArg(domain.AuthzCatalogStatusActive.String())
}

// WriteHasAuthzProjectFoothold emits SELECT (foothold).
// homeProjectID is the membership-edge project (empty falls back to projectID).
func WriteHasAuthzProjectFoothold(w ArgWriter, env Env, projectID, homeProjectID string, principalType domain.AuthzPrincipalType, principalID string) {
	w.WriteString("SELECT ")
	writeFoothold(w, env, projectID, homeProjectID, principalType, principalID)
}

// WriteCheckAuthz emits SELECT (allowed), (foothold) in one round-trip.
func WriteCheckAuthz(w ArgWriter, env Env, params domain.AuthzCheckParams) {
	w.WriteString("SELECT (")
	writeCheckAllowed(w, env, params)
	w.WriteString("), ")
	writeFoothold(w, env, params.ProjectID, params.HomeProjectID(), params.PrincipalType, params.PrincipalID)
}

func writeCheckAllowed(w ArgWriter, env Env, params domain.AuthzCheckParams) {
	w.WriteString("(")
	writeProjectScopedClosureExists(w, env, params)
	w.WriteString(" OR ")
	writeFullTTUExists(w, env, params)
	if params.ResourceTeamID != "" {
		w.WriteString(" OR ")
		writeScopedClosureExists(w, env, params, "team", "")
		// writeScopedClosureExists for team expects a SQL expr; bind ResourceTeamID.
	}
	if params.ResourceID != "" {
		w.WriteString(" OR ")
		writeScopedClosureExists(w, env, params, "resource", "")
	}
	w.WriteString(")")
	if params.ConstraintTeamID != "" && params.ResourceID != "" {
		w.WriteString(" AND ")
		writeCheckedObjectInConstraintTeam(w, env, params)
	}
}

// WriteListAuthzObjectIDs emits SELECT resource_id … ORDER BY resource_id.
func WriteListAuthzObjectIDs(w ArgWriter, env Env, params domain.AuthzListObjectsParams) {
	w.WriteString(`
SELECT r.resource_id
FROM `)
	writeTable(w, env, "resource_scope_index")
	w.WriteString(` r
WHERE `)
	writeListAuthzRSIBase(w, env, params, "", func() {
		writeConstantVisibilityArms(w, env, params.AuthzCheckParams)
		w.WriteString(`
    OR `)
		writeCorrelatedVisibilityArms(w, env, params.AuthzCheckParams)
	})
	w.WriteString(`
ORDER BY r.resource_id`)
}

// WriteListAuthzExistsPredicate emits the per-row visibility test for a
// management list. outerResourceIDExpr is a raw SQL column reference
// (e.g. "zitadel_nextgen.teams.id").
//
// The constant arms are lifted out of the correlated subquery by the
// distributive law, so a planner evaluates them once rather than per listed row:
//
//	EXISTS(base AND (C OR Q))  ==  (C AND EXISTS(base)) OR EXISTS(base AND Q)
//
// `C AND EXISTS(base)` is required, not cosmetic: an object with no RSI row must
// stay invisible even when C is true, so C alone can never grant it.
func WriteListAuthzExistsPredicate(w ArgWriter, env Env, outerResourceIDExpr string, params domain.AuthzListObjectsParams) {
	w.WriteString(`((`)
	writeConstantVisibilityArms(w, env, params.AuthzCheckParams)
	w.WriteString(`)
  AND `)
	writeListAuthzRSIExists(w, env, params, outerResourceIDExpr, nil)
	w.WriteString(`
  OR `)
	writeListAuthzRSIExists(w, env, params, outerResourceIDExpr, func() {
		writeCorrelatedVisibilityArms(w, env, params.AuthzCheckParams)
	})
	w.WriteString(`)`)
}

// writeListAuthzRSIExists wraps one half of the lifted predicate in
// EXISTS (SELECT 1 FROM RSI r WHERE …). Pass nil arms for the existence-only
// half. outerResourceIDExpr must not be empty here: dropping the correlation
// would collapse the half to "does any RSI row exist for this project and
// kind", which admits every row.
func writeListAuthzRSIExists(w ArgWriter, env Env, params domain.AuthzListObjectsParams, outerResourceIDExpr string, arms func()) {
	w.WriteString(`EXISTS (
SELECT 1
FROM `)
	writeTable(w, env, "resource_scope_index")
	w.WriteString(` r
WHERE `)
	writeListAuthzRSIBase(w, env, params, outerResourceIDExpr, arms)
	w.WriteString(`
)`)
}

// writeListAuthzRSIBase writes the RSI row filter every caller starts from, plus
// the constraint-team clause every caller ends with. Both decide who can see
// what, on the materialising path and the EXISTS path alike, so they have one
// definition rather than a copy per caller. When outerResourceIDExpr is
// non-empty, r.resource_id is correlated to that outer column.
func writeListAuthzRSIBase(w ArgWriter, env Env, params domain.AuthzListObjectsParams, outerResourceIDExpr string, arms func()) {
	if outerResourceIDExpr != "" {
		w.WriteString(`r.resource_id = `)
		w.WriteString(outerResourceIDExpr)
		w.WriteString(`
  AND `)
	}
	w.WriteString(`r.project_id = `)
	w.WriteArg(params.ProjectID)
	w.WriteString(`
  AND r.resource_kind = `)
	w.WriteArg(params.ResourceKind.String())
	if arms != nil {
		w.WriteString(`
  AND (
    `)
		arms()
		w.WriteString(`
  )`)
	}
	// Correlated to r, so it belongs to whichever RSI subquery is being written
	// and cannot be distributed out of either half of the lift.
	if params.ConstraintTeamID != "" {
		w.WriteString(`
  AND `)
		writeListedObjectInConstraintTeam(w, env, params)
	}
}

// writeConstantVisibilityArms writes the arms that cannot reference r: their
// truth value is fixed once the bind arguments are bound.
func writeConstantVisibilityArms(w ArgWriter, env Env, params domain.AuthzCheckParams) {
	writeProjectScopedClosureExists(w, env, params)
	w.WriteString(`
    OR `)
	writeFullTTUExists(w, env, params)
}

// writeCorrelatedVisibilityArms writes the arms that do reference r, and so must
// be evaluated against each candidate row.
func writeCorrelatedVisibilityArms(w ArgWriter, env Env, params domain.AuthzCheckParams) {
	w.WriteString(`(
        r.team_id IS NOT NULL
        AND `)
	writeScopedClosureExists(w, env, params, "team", "r.team_id")
	w.WriteString(`
    )
    OR `)
	writeScopedClosureExists(w, env, params, "resource", "r.resource_id")
}

// writeCheckedObjectInConstraintTeam is the per-object sk_team_ compensating
// constraint for Check: the ResourceID is a member of ConstraintTeamID, is
// the team itself, or (non-user kinds) ResourceTeamID matches RSI.team_id.
func writeCheckedObjectInConstraintTeam(w ArgWriter, env Env, params domain.AuthzCheckParams) {
	w.WriteString("(")
	writeUserMembershipInTeam(w, env, params.ProjectID, "", params.ConstraintTeamID, "", params.ResourceID)
	w.WriteString(" OR ")
	w.WriteArg(params.ResourceID)
	w.WriteString(" = ")
	w.WriteArg(params.ConstraintTeamID)
	if params.ResourceTeamID != "" {
		w.WriteString(" OR ")
		w.WriteArg(params.ResourceTeamID)
		w.WriteString(" = ")
		w.WriteArg(params.ConstraintTeamID)
	}
	w.WriteString(")")
}

// writeListedObjectInConstraintTeam filters list/EXISTS rows to the token team.
// Users are not team-keyed in RSI — membership edges are the source of truth.
// The RSI.team_id disjunct is gated off user and team kinds so a stray
// team_id on a user row cannot skip the membership edge.
func writeListedObjectInConstraintTeam(w ArgWriter, env Env, params domain.AuthzListObjectsParams) {
	w.WriteString("(")
	w.WriteString("(r.resource_kind = ")
	w.WriteArg(domain.ResourceKindUser.String())
	w.WriteString(" AND ")
	writeUserMembershipInTeam(w, env, params.ProjectID, "", params.ConstraintTeamID, "r.resource_id", "")
	w.WriteString(") OR (r.resource_kind = ")
	w.WriteArg(domain.ResourceKindTeam.String())
	w.WriteString(" AND r.resource_id = ")
	w.WriteArg(params.ConstraintTeamID)
	w.WriteString(") OR (r.resource_kind <> ")
	w.WriteArg(domain.ResourceKindUser.String())
	w.WriteString(" AND r.resource_kind <> ")
	w.WriteArg(domain.ResourceKindTeam.String())
	w.WriteString(" AND r.team_id IS NOT NULL AND r.team_id = ")
	w.WriteArg(params.ConstraintTeamID)
	w.WriteString("))")
}

// writeUserMembershipInTeam emits EXISTS on authz_membership_edges: user is a
// member of a team. setIDExpr / memberIDExpr are raw SQL column refs; when
// empty, setID / memberID are bound arguments. Check, List, TTU, and
// principal-match all use this helper so ADR 053's home-project switch is one edit.
func writeUserMembershipInTeam(w ArgWriter, env Env, projectID, setIDExpr, setID, memberIDExpr, memberID string) {
	w.WriteString(`EXISTS (
        SELECT 1
        FROM `)
	writeTable(w, env, "authz_membership_edges")
	w.WriteString(` e
        WHERE e.project_id = `)
	w.WriteArg(projectID)
	w.WriteString(`
          AND e.set_type = 'team'
          AND e.set_id = `)
	writeExprOrArg(w, setIDExpr, setID)
	w.WriteString(`
          AND e.member_type = 'user'
          AND e.member_id = `)
	writeExprOrArg(w, memberIDExpr, memberID)
	w.WriteString(`
    )`)
}

func writeExprOrArg(w ArgWriter, expr, arg string) {
	if expr != "" {
		w.WriteString(expr)
		return
	}
	w.WriteArg(arg)
}

func writeFoothold(w ArgWriter, env Env, projectID, homeProjectID string, principalType domain.AuthzPrincipalType, principalID string) {
	ptype := principalType.String()
	home := domain.AuthzHomeProjectID(homeProjectID, projectID)
	w.WriteString(`(
    EXISTS (
        SELECT 1
        FROM `)
	writeTable(w, env, "authz_assignments")
	w.WriteString(` a
        WHERE a.project_id = `)
	w.WriteArg(projectID)
	w.WriteString(`
          AND a.revoked_at IS NULL
          AND `)
	writeExpiresActive(w, env, "a")
	w.WriteString(`
          AND `)
	// Assignments stay on the protected project. Team expand reads
	// authz_membership_edges in the principal's home project (ADR 053).
	writePrincipalMatch(w, env, "a", ptype, principalID, home)
	w.WriteString(`
    )
    OR EXISTS (
        SELECT 1
        FROM `)
	writeTable(w, env, "authz_membership_edges")
	w.WriteString(` e
        WHERE e.project_id = `)
	w.WriteArg(projectID)
	w.WriteString(`
          AND e.member_type = 'user'
          AND e.member_id = `)
	w.WriteArg(principalID)
	w.WriteString(`
          AND `)
	w.WriteArg(ptype)
	w.WriteString(` = 'user'
    )
)`)
}

func writeProjectScopedClosureExists(w ArgWriter, env Env, params domain.AuthzCheckParams) {
	writeScopedClosureExists(w, env, params, "project", "")
}

func writeScopedClosureExists(w ArgWriter, env Env, params domain.AuthzCheckParams, scopeKind, scopeIDExpr string) {
	home := params.HomeProjectID()
	ptype := params.PrincipalType.String()

	w.WriteString(`EXISTS (
        SELECT 1
        FROM `)
	writeTable(w, env, "authz_assignments")
	w.WriteString(` a
        JOIN `)
	writeTable(w, env, "authz_relation_closure")
	w.WriteString(` c
          ON  c.catalog_id       = a.catalog_id
          AND c.from_object_type = a.object_type
          AND c.from_relation    = a.relation
          AND c.to_object_type   = `)
	w.WriteArg(params.ObjectType)
	w.WriteString(`
          AND c.to_relation      = `)
	w.WriteArg(params.Relation)
	w.WriteString(`
        WHERE a.project_id = `)
	w.WriteArg(params.ProjectID)
	w.WriteString(`
          AND a.catalog_id = `)
	w.WriteArg(params.CatalogID)
	w.WriteString(`
          AND a.revoked_at IS NULL
          AND `)
	writeExpiresActive(w, env, "a")
	w.WriteString(`
          AND `)
	switch scopeKind {
	case "project":
		w.WriteString("a.scope_kind = 'project'")
	case "team":
		w.WriteString("a.scope_kind = 'team' AND a.scope_team_id = ")
		if scopeIDExpr != "" {
			w.WriteString(scopeIDExpr)
		} else {
			w.WriteArg(params.ResourceTeamID)
		}
	case "resource":
		w.WriteString("a.scope_kind = 'resource' AND a.scope_resource_id = ")
		if scopeIDExpr != "" {
			w.WriteString(scopeIDExpr)
		} else {
			w.WriteArg(params.ResourceID)
		}
	default:
		panic("unknown scope kind " + scopeKind)
	}
	w.WriteString(`
          AND `)
	writePrincipalMatch(w, env, "a", ptype, params.PrincipalID, home)
	w.WriteString(`
    )`)
}

func writeFullTTUExists(w ArgWriter, env Env, params domain.AuthzCheckParams) {
	home := params.HomeProjectID()
	ptype := params.PrincipalType.String()

	w.WriteString(`EXISTS (
        SELECT 1
        FROM `)
	writeTable(w, env, "authz_expression_edges")
	w.WriteString(` edge
        JOIN `)
	writeTable(w, env, "authz_assignments")
	w.WriteString(` ts
          ON  ts.catalog_id  = edge.catalog_id
          AND ts.object_type = edge.tupleset_object_type
          AND ts.relation    = edge.tupleset_relation
          AND ts.principal_type = edge.source_object_type
          AND ts.project_id  = `)
	w.WriteArg(params.ProjectID)
	w.WriteString(`
          AND ts.revoked_at IS NULL
          AND `)
	writeExpiresActive(w, env, "ts")
	w.WriteString(`
        WHERE edge.catalog_id = `)
	w.WriteArg(params.CatalogID)
	w.WriteString(`
          AND edge.object_type = `)
	w.WriteArg(params.ObjectType)
	w.WriteString(`
          AND edge.relation = `)
	w.WriteArg(params.Relation)
	w.WriteString(`
          AND edge.kind = 'tuple_to_userset'
          AND (
                (
                    edge.source_object_type = 'team'
                AND edge.source_relation = 'member'
                AND ts.principal_type = 'team'
                AND `)
	w.WriteArg(ptype)
	w.WriteString(` = 'user'
                AND `)
	writeUserMembershipInTeam(w, env, home, "ts.principal_id", "", "", params.PrincipalID)
	w.WriteString(`
                )
             OR EXISTS (
                    SELECT 1
                    FROM `)
	writeTable(w, env, "authz_assignments")
	w.WriteString(` a
                    JOIN `)
	writeTable(w, env, "authz_relation_closure")
	w.WriteString(` c
                      ON  c.catalog_id       = a.catalog_id
                      AND c.from_object_type = a.object_type
                      AND c.from_relation    = a.relation
                      AND c.to_object_type   = edge.source_object_type
                      AND c.to_relation      = edge.source_relation
                    WHERE a.project_id = `)
	w.WriteArg(params.ProjectID)
	w.WriteString(`
                      AND a.catalog_id = `)
	w.WriteArg(params.CatalogID)
	w.WriteString(`
                      AND a.revoked_at IS NULL
                      AND `)
	writeExpiresActive(w, env, "a")
	w.WriteString(`
                      AND `)
	writePrincipalMatch(w, env, "a", ptype, params.PrincipalID, home)
	w.WriteString(`
                      AND (
                            (a.scope_kind = 'team' AND a.scope_team_id = ts.principal_id)
                         OR (a.scope_kind = 'resource' AND a.scope_resource_id = ts.principal_id)
                         OR (a.scope_kind = 'project' AND a.object_type = edge.source_object_type)
                      )
                )
          )
    )`)
}

func writePrincipalMatch(w ArgWriter, env Env, alias, principalType, principalID, homeProjectID string) {
	w.WriteString(`(
                (`)
	w.WriteString(alias)
	w.WriteString(`.principal_type = `)
	w.WriteArg(principalType)
	w.WriteString(` AND `)
	w.WriteString(alias)
	w.WriteString(`.principal_id = `)
	w.WriteArg(principalID)
	w.WriteString(`)
             OR (
                    `)
	w.WriteArg(principalType)
	w.WriteString(` = 'user'
                AND `)
	w.WriteString(alias)
	w.WriteString(`.principal_type = 'team'
                AND `)
	writeUserMembershipInTeam(w, env, homeProjectID, alias+".principal_id", "", "", principalID)
	w.WriteString(`
             )
          )`)
}
