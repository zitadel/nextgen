package api

import (
	"context"
	"errors"

	"github.com/zitadel/nextgen/internal/authz/resolver"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// The management API (the operator plane of ADR 036: schemas, flow
// definitions, users, teams, project queries) is gated by the authz
// permission resolver after credential → resolved project scope.
//
// Path-id operations resolve scope via resource_scope_index
// (requireResourceAccess) before Check. Create/list keep an explicit
// project_id and use requireProjectAccess.
//
// MVP checks use the seeded system catalog's coarse project.{viewer,editor,admin}
// relations (#420 will expand to fine-grained user.read / schema.write, etc.).
// Preview secrets keep a token-scope ceiling so project.read cannot write.

// accessOp classifies a management operation for permission mapping.
type accessOp int

const (
	opRead accessOp = iota
	opWrite
	opDelete
)

// projectRelation is the catalog relation checked for an accessOp.
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
// resource-flavored errors the gate answers with. Fine OpenAPI scopes remain
// documentation / future catalog expansion; enforcement is resolver.Check.
type resourceAccess struct {
	// readMiss and writeMiss are the anti-oracle answers for a project the
	// principal has no foothold in; writeMiss doubles as the nonexistent-project
	// answer since the gate cannot (and must not) tell the two apart.
	readMiss  func() domain.Error
	writeMiss func() domain.Error
	denied    func() domain.Error
}

var schemaAccess = resourceAccess{
	readMiss:  domain.ErrJSONSchemaNotFound,
	writeMiss: func() domain.Error { return domain.ErrJSONSchemaInvalid().WithDetails("project does not exist") },
	denied:    domain.ErrJSONSchemaPermissionDenied,
}

var flowDefinitionAccess = resourceAccess{
	readMiss:  domain.ErrFlowDefinitionNotFound,
	writeMiss: func() domain.Error { return domain.ErrFlowDefinitionInvalid("project does not exist", nil) },
	denied:    domain.ErrFlowDefinitionPermissionDenied,
}

var userAccess = resourceAccess{
	readMiss:  domain.ErrUserNotFound,
	writeMiss: func() domain.Error { return domain.ErrUserInvalid().WithDetails("project does not exist") },
	denied:    domain.ErrUserPermissionDenied,
}

var teamAccess = resourceAccess{
	readMiss: domain.ErrTeamNotFound,
	// The team service already answers nonexistent projects with
	// team.project_not_found; foreign projects must be indistinguishable.
	writeMiss: domain.ErrTeamProjectNotFound,
	denied:    domain.ErrTeamPermissionDenied,
}

// sessionAccess gates operator session management (get/list/revoke by id).
// Create and exchange stay on the runtime/app plane and are not checked here.
var sessionAccess = resourceAccess{
	readMiss:  domain.ErrSessionNotFound,
	writeMiss: domain.ErrSessionNotFound,
	denied:    domain.ErrSessionPermissionDenied,
}

var brandingAccess = resourceAccess{
	readMiss:  domain.ErrBrandingNotFound,
	writeMiss: func() domain.Error { return domain.ErrBrandingInvalid("project does not exist", nil) },
	denied:    domain.ErrBrandingPermissionDenied,
}

var projectAccess = resourceAccess{
	readMiss:  domain.ErrProjectNotFound,
	writeMiss: domain.ErrProjectNotFound,
	denied:    domain.ErrProjectPermissionDenied,
}

// resourceAccessStmts is the statement surface requireResourceAccess needs:
// RSI lookup plus the authz resolver Check path.
type resourceAccessStmts interface {
	service.AuthzResolverStatements
	GetResourceScope(ctx context.Context, resourceID string) (*domain.ResourceScope, error)
}

// requireResourceAccess resolves path.id via resource_scope_index, then runs
// the project-scoped Check. RSI miss → resource not-found shape (404). Returns
// the resolved project_id for scope-bound DAL calls. team_id from RSI is
// available on the scope row for future sk_team team-scope tightening.
func (h *Handler) requireResourceAccess(ctx context.Context, resourceID string, res resourceAccess, op accessOp) (projectID string, err error) {
	if h == nil || h.pool == nil {
		return "", resourceMiss(res, op)
	}
	return requireResourceAccess(ctx, h.pool.Statements(), resourceID, res, op)
}

func requireResourceAccess(ctx context.Context, stmts resourceAccessStmts, resourceID string, res resourceAccess, op accessOp) (string, error) {
	scope, err := stmts.GetResourceScope(ctx, resourceID)
	if err != nil {
		if errors.Is(err, new(database.NoRowFoundError)) {
			return "", resourceMiss(res, op)
		}
		return "", domain.ErrInternal(err).WithMessage("resource scope lookup failed")
	}
	if err := requireProjectAccess(ctx, stmts, scope.ProjectID, res, op); err != nil {
		return "", err
	}
	return scope.ProjectID, nil
}

func resourceMiss(res resourceAccess, op accessOp) error {
	if op == opWrite {
		return res.writeMiss()
	}
	return res.readMiss()
}

// requireProjectAccess gates a management operation via resolver.Check when
// project_id is already known (create/list/query, or after RSI resolution).
// DecisionNotFound → resource not-found / invalid-project shapes (404).
// DecisionForbidden → permission_denied (403).
func (h *Handler) requireProjectAccess(ctx context.Context, projectID string, res resourceAccess, op accessOp) error {
	if h == nil || h.pool == nil {
		return res.readMiss()
	}
	return requireProjectAccess(ctx, h.pool.Statements(), projectID, res, op)
}

func requireProjectAccess(ctx context.Context, stmts service.AuthzResolverStatements, projectID string, res resourceAccess, op accessOp) error {
	scope, ok := GetScopeContext(ctx)
	if !ok || scope.PrincipalType == "" || scope.PrincipalID == "" {
		if op == opWrite {
			return res.writeMiss()
		}
		return res.readMiss()
	}

	relation := projectRelation(op)
	if !tokenScopeAllowsRelation(scope.Scope, relation) {
		// Bound to another project → anti-oracle miss; same project → denied.
		if scope.ProjectID == "" || scope.ProjectID != projectID {
			if op == opWrite {
				return res.writeMiss()
			}
			return res.readMiss()
		}
		return res.denied()
	}

	dec, err := resolver.New().Check(ctx, stmts, resolver.Request{
		PrincipalType:   scope.PrincipalType,
		PrincipalID:     scope.PrincipalID,
		CredentialClass: scope.PrincipalType,
		ProjectID:       projectID,
		ObjectType:      "project",
		Relation:        relation,
	})
	if err != nil {
		return domain.ErrInternal(err).WithMessage("authz permission check failed")
	}
	return mapAuthzDecision(dec, res, op)
}

// tokenScopeAllowsRelation is the credential-plane ceiling for management
// ops: the full project secret (project.write) unlocks viewer/editor/admin
// checks. The preview/origin-scoped secret (project.read only) is
// browser-plane and cannot call the management API at all (ADR 037).
func tokenScopeAllowsRelation(granted []string, _ string) bool {
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
		if op == opWrite {
			return res.writeMiss()
		}
		return res.readMiss()
	default:
		if op == opWrite {
			return res.writeMiss()
		}
		return res.readMiss()
	}
}

// withAuthzListFilter attaches the SQL list-predicate filter for management
// list endpoints after requireProjectAccess has already passed.
func (h *Handler) withAuthzListFilter(ctx context.Context, projectID string, kind domain.ResourceKind, op accessOp) (context.Context, error) {
	scope, ok := GetScopeContext(ctx)
	if !ok || h == nil || h.pool == nil {
		return ctx, nil
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
		CatalogID:              catalogID,
		ProjectID:              projectID,
		PrincipalHomeProjectID: home,
		PrincipalType:          scope.PrincipalType,
		PrincipalID:            scope.PrincipalID,
		ResourceKind:           kind,
		ObjectType:             "project",
		Relation:               projectRelation(op),
	}), nil
}

// requireUserTeamsAccess gates listUserTeams via the parent user's RSI, then
// checks both user and team read relations on the resolved project.
func (h *Handler) requireUserTeamsAccess(ctx context.Context, userID string) (projectID string, err error) {
	projectID, err = h.requireResourceAccess(ctx, userID, userAccess, opRead)
	if err != nil {
		return "", err
	}
	if err := h.requireProjectAccess(ctx, projectID, teamAccess, opRead); err != nil {
		return "", err
	}
	return projectID, nil
}

// requireTeamDelete gates deleteTeam via the team's RSI. Deleting an unknown
// team answers 204, so the endpoint has no not-found to report: a project the
// credentials are not authorized for is refused as the permission failure it
// is when foothold exists; no foothold stays a not-found-shaped miss mapped
// through denied for delete (see requireTeamDelete historical contract).
func (h *Handler) requireTeamDelete(ctx context.Context, teamID string) (projectID string, err error) {
	projectID, err = h.requireResourceAccess(ctx, teamID, teamAccess, opDelete)
	if err != nil {
		return "", domain.ErrTeamPermissionDenied().WithParent(err)
	}
	return projectID, nil
}
