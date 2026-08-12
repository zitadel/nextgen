package api

import (
	"context"
	"errors"

	"github.com/zitadel/nextgen/internal/authz/resolver"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// The management API (operator plane: schemas, flow definitions, users, teams,
// project queries, branding, operator sessions) is gated by resolver.Check after
// credential → ScopeContext. Path-id ops resolve scope via resource_scope_index
// (requireResourceAccess) before Check; create/list keep an explicit project_id
// and use requireProjectAccess, then inject an EXISTS list predicate via
// withAuthzListFilter. MVP uses coarse project.{viewer,editor,admin}
// (#420 expands to fine-grained catalog relations). Preview secrets
// (project.read only) cannot call management APIs (ADR 037).

// accessOp classifies a management operation for relation mapping and miss shaping.
type accessOp int

const (
	opRead accessOp = iota
	opWrite
	opDelete
)

// errResourceGone means path.id has no RSI row in the caller's project scope.
// Idempotent deletes map this to 204 only for credential-plane operators
// (project.write); others get readMiss. Deliberate tradeoff: operators with any
// project secret can still distinguish fabricated ids (204) from real foreign
// resources (404/403 after RSI hit). Full oracle close would require RSI miss
// → readMiss unless the principal has a foothold, at the cost of repeated-delete 204s.
var errResourceGone = errors.New("authz: resource gone")

// projectRelation is the catalog relation checked for an accessOp.
// Until #420, the seeded viewer grant satisfies viewer/editor/admin Checks.
func projectRelation(op accessOp) string {
	switch op {
	case opRead:
		return "viewer"
	case opWrite:
		return "editor"
	case opDelete:
		return "admin"
	default:
		return "admin"
	}
}

// resourceAccess is one resource's row in the management access model: the
// resource-flavored errors the gate answers with, plus the RSI kind the route
// expects for path-id ops.
type resourceAccess struct {
	// kind is the expected resource_scope_index.resource_kind for path-id ops.
	// Empty means no kind check (project-scoped create/list only).
	kind domain.ResourceKind
	// readMiss / writeMiss are anti-oracle answers when Check finds no foothold;
	// writeMiss also covers nonexistent projects on create/list.
	readMiss  func() domain.Error
	writeMiss func() domain.Error
	denied    func() domain.Error
}

func (res resourceAccess) miss(op accessOp) error {
	if op == opWrite {
		return res.writeMiss()
	}
	return res.readMiss()
}

var schemaAccess = resourceAccess{
	kind:      domain.ResourceKindSchema,
	readMiss:  domain.ErrJSONSchemaNotFound,
	writeMiss: func() domain.Error { return domain.ErrJSONSchemaInvalid().WithDetails("project does not exist") },
	denied:    domain.ErrJSONSchemaPermissionDenied,
}

var flowDefinitionAccess = resourceAccess{
	kind:      domain.ResourceKindFlowDefinition,
	readMiss:  domain.ErrFlowDefinitionNotFound,
	writeMiss: func() domain.Error { return domain.ErrFlowDefinitionInvalid("project does not exist", nil) },
	denied:    domain.ErrFlowDefinitionPermissionDenied,
}

var userAccess = resourceAccess{
	kind:      domain.ResourceKindUser,
	readMiss:  domain.ErrUserNotFound,
	writeMiss: func() domain.Error { return domain.ErrUserInvalid().WithDetails("project does not exist") },
	denied:    domain.ErrUserPermissionDenied,
}

var teamAccess = resourceAccess{
	kind:     domain.ResourceKindTeam,
	readMiss: domain.ErrTeamNotFound,
	// team.project_not_found matches the service's nonexistent-project answer.
	writeMiss: domain.ErrTeamProjectNotFound,
	denied:    domain.ErrTeamPermissionDenied,
}

// sessionAccess gates operator session get/list/revoke. Create/exchange stay
// on the runtime plane. MVP: same project.write ceiling + project relation
// Check as other management resources (replacing the old fail-closed session.*
// scope gate until #420).
var sessionAccess = resourceAccess{
	kind:      domain.ResourceKindSession,
	readMiss:  domain.ErrSessionNotFound,
	writeMiss: domain.ErrSessionNotFound,
	denied:    domain.ErrSessionPermissionDenied,
}

var brandingAccess = resourceAccess{
	kind:      domain.ResourceKindBranding,
	readMiss:  domain.ErrBrandingNotFound,
	writeMiss: func() domain.Error { return domain.ErrBrandingInvalid("project does not exist", nil) },
	denied:    domain.ErrBrandingPermissionDenied,
}

var projectAccess = resourceAccess{
	kind:      domain.ResourceKindProject,
	readMiss:  domain.ErrProjectNotFound,
	writeMiss: domain.ErrProjectNotFound,
	denied:    domain.ErrProjectPermissionDenied,
}

// resourceAccessStmts is the statement surface requireResourceAccess needs.
type resourceAccessStmts interface {
	service.AuthzResolverStatements
	service.ResourceScopeStatements
}

// requireResourceAccess resolves path.id via resource_scope_index (project-scoped
// when the credential carries project_id), then runs the project-scoped Check.
// RSI miss on read/write → resource 404; on delete → errResourceGone for
// operators (handlers map to 204), else readMiss. Returns project_id for DAL calls.
func (h *Handler) requireResourceAccess(ctx context.Context, resourceID string, res resourceAccess, op accessOp) (projectID string, err error) {
	if h == nil || h.pool == nil {
		return "", domain.ErrInternal(errors.New("authz statements not configured"))
	}
	return requireResourceAccess(ctx, h.pool.Statements(), resourceID, res, op)
}

func lookupResourceScope(ctx context.Context, stmts resourceAccessStmts, resourceID string, res resourceAccess) (*domain.ResourceScope, error) {
	if res.kind != "" {
		if cred, ok := GetScopeContext(ctx); ok && cred.ProjectID != "" {
			scope, err := stmts.GetResourceScopeInProject(ctx, res.kind, cred.ProjectID, resourceID)
			if err == nil {
				return scope, nil
			}
			if !errors.Is(err, new(database.NoRowFoundError)) {
				return nil, err
			}
			// Same-project row under a different kind (e.g. schema id on a user route).
			if global, gerr := stmts.GetResourceScope(ctx, resourceID); gerr == nil && global.ProjectID == cred.ProjectID {
				return global, nil
			}
			return nil, new(database.NoRowFoundError)
		}
	}
	return stmts.GetResourceScope(ctx, resourceID)
}

func requireResourceAccess(ctx context.Context, stmts resourceAccessStmts, resourceID string, res resourceAccess, op accessOp) (string, error) {
	scope, err := lookupResourceScope(ctx, stmts, resourceID, res)
	if err != nil {
		if errors.Is(err, new(database.NoRowFoundError)) {
			if op == opDelete {
				cred, ok := GetScopeContext(ctx)
				if ok && hasOperatorProjectWrite(cred.Scope) {
					// Idempotent 204 only when the id is gone everywhere. A row in
					// another project must not 204 — map through Check (foreign
					// delete probes expect 404/403, not NoContent).
					if global, gerr := stmts.GetResourceScope(ctx, resourceID); gerr == nil && global.ProjectID != cred.ProjectID {
						if res.kind != "" && global.ResourceKind != res.kind {
							return "", res.readMiss()
						}
						if err := requireProjectAccessAfterRSI(ctx, stmts, global.ProjectID, res, op); err != nil {
							return "", err
						}
						return global.ProjectID, nil
					}
					return "", errResourceGone
				}
				return "", res.readMiss()
			}
			// Flat-by-id: unknown path id is always the resource 404 shape.
			return "", res.readMiss()
		}
		return "", domain.ErrInternal(err).WithMessage("resource scope lookup failed")
	}
	if res.kind != "" && scope.ResourceKind != res.kind {
		// Wrong kind for this route: same anti-oracle shape as unknown id.
		return "", res.readMiss()
	}
	if err := requireProjectAccessAfterRSI(ctx, stmts, scope.ProjectID, res, op); err != nil {
		return "", err
	}
	return scope.ProjectID, nil
}

// requireProjectAccess gates a management operation via resolver.Check when
// project_id is already known (create/list/query, project by-id, or after RSI).
// DecisionNotFound → resource not-found / invalid-project shapes (404).
// DecisionForbidden → permission_denied (403).
func (h *Handler) requireProjectAccess(ctx context.Context, projectID string, res resourceAccess, op accessOp) error {
	if h == nil || h.pool == nil {
		return domain.ErrInternal(errors.New("authz statements not configured"))
	}
	return requireProjectAccess(ctx, h.pool.Statements(), projectID, res, op)
}

func requireProjectAccess(ctx context.Context, stmts service.AuthzResolverStatements, projectID string, res resourceAccess, op accessOp) error {
	return requireProjectAccessMapped(ctx, stmts, projectID, res, op, false)
}

// requireProjectAccessAfterRSI is requireProjectAccess for by-id ops after an
// RSI hit: DecisionNotFound always uses readMiss (not writeMiss) so PATCH routes
// do not leak existence via mismatched codes.
func requireProjectAccessAfterRSI(ctx context.Context, stmts service.AuthzResolverStatements, projectID string, res resourceAccess, op accessOp) error {
	return requireProjectAccessMapped(ctx, stmts, projectID, res, op, true)
}

func requireProjectAccessMapped(ctx context.Context, stmts service.AuthzResolverStatements, projectID string, res resourceAccess, op accessOp, afterRSI bool) error {
	scope, ok := GetScopeContext(ctx)
	if !ok || scope.PrincipalType == "" || scope.PrincipalID == "" {
		if afterRSI {
			return res.readMiss()
		}
		return res.miss(op)
	}

	if !hasOperatorProjectWrite(scope.Scope) {
		// Foreign / unbound → anti-oracle miss; same project → denied (preview).
		if scope.ProjectID == "" || scope.ProjectID != projectID {
			if afterRSI {
				return res.readMiss()
			}
			return res.miss(op)
		}
		return res.denied()
	}

	// MVP: Check ObjectType "project" only — team-/resource-scoped Allow is out
	// of scope until a later gate (#833).
	dec, err := resolver.New().Check(ctx, stmts, resolver.Request{
		PrincipalType: scope.PrincipalType,
		PrincipalID:   scope.PrincipalID,
		ProjectID:     projectID,
		ObjectType:    "project",
		Relation:      projectRelation(op),
	})
	if err != nil {
		return domain.ErrInternal(err).WithMessage("authz permission check failed")
	}
	if afterRSI {
		return mapAuthzDecisionAfterRSI(dec, res)
	}
	return mapAuthzDecision(dec, res, op)
}

// hasOperatorProjectWrite is the credential-plane ceiling: only the full
// project secret (project.write) may call management APIs. Preview
// (project.read only) is browser-plane (ADR 037).
func hasOperatorProjectWrite(granted []string) bool {
	for _, s := range granted {
		if s == "project.write" {
			return true
		}
	}
	return false
}

func mapAuthzDecision(dec resolver.Decision, res resourceAccess, op accessOp) error {
	switch dec {
	case resolver.DecisionAllow:
		return nil
	case resolver.DecisionForbidden:
		return res.denied()
	case resolver.DecisionNotFound, resolver.DecisionUnspecified:
		return res.miss(op)
	default:
		return res.miss(op)
	}
}

// mapAuthzDecisionAfterRSI maps Check results after RSI already located the
// resource. NotFound/Unspecified always use readMiss so write ops do not
// advertise a different code than reads.
func mapAuthzDecisionAfterRSI(dec resolver.Decision, res resourceAccess) error {
	switch dec {
	case resolver.DecisionAllow:
		return nil
	case resolver.DecisionForbidden:
		return res.denied()
	case resolver.DecisionNotFound, resolver.DecisionUnspecified:
		return res.readMiss()
	default:
		return res.readMiss()
	}
}

// withAuthzListFilter attaches the SQL list-predicate filter for management
// list endpoints after requireProjectAccess has already passed.
// PrincipalHomeProjectID comes from the credential's home project while Check
// uses the target projectID; those are equivalent until foreign footholds
// (#333) land.
func (h *Handler) withAuthzListFilter(ctx context.Context, projectID string, kind domain.ResourceKind, op accessOp) (context.Context, error) {
	scope, ok := GetScopeContext(ctx)
	if !ok || scope.PrincipalType == "" || scope.PrincipalID == "" {
		return ctx, domain.ErrInternal(nil).WithMessage("authz list filter requires credential scope")
	}
	if h == nil || h.pool == nil {
		return ctx, domain.ErrInternal(errors.New("authz statements not configured"))
	}
	catalogID, err := h.pool.Statements().ActiveSystemCatalogID(ctx)
	if err != nil {
		return ctx, domain.ErrInternal(err).WithMessage("authz catalog lookup failed")
	}
	home := scope.ProjectID
	if home == "" {
		home = projectID
	}
	return service.WithAuthzListFilter(ctx, service.AuthzListFilter{
		AuthzCheckParams: domain.AuthzCheckParams{
			CatalogID:              catalogID,
			ProjectID:              projectID,
			PrincipalHomeProjectID: home,
			PrincipalType:          scope.PrincipalType,
			PrincipalID:            scope.PrincipalID,
			ObjectType:             "project",
			Relation:               projectRelation(op),
		},
		ResourceKind: kind,
	}), nil
}

// requireTeamDelete gates deleteTeam via the team's RSI. Unknown teams are
// gone (204) for operators. Check denials (including foreign foothold misses)
// stay permission_denied for the historical deleteTeam contract. Internal
// errors pass through unwrapped so operators see 500, not a false 403.
func (h *Handler) requireTeamDelete(ctx context.Context, teamID string) (projectID string, err error) {
	projectID, err = h.requireResourceAccess(ctx, teamID, teamAccess, opDelete)
	if err != nil {
		if errors.Is(err, errResourceGone) {
			return "", err
		}
		if errors.Is(err, domain.ErrInternal(nil)) {
			return "", err
		}
		return "", domain.ErrTeamPermissionDenied().WithParent(err)
	}
	return projectID, nil
}
