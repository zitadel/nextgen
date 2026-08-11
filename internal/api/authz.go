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
// and use requireProjectAccess. MVP uses coarse project.{viewer,editor,admin}
// (#420 expands to fine-grained catalog relations). Preview secrets
// (project.read only) cannot call management APIs (ADR 037).

// accessOp classifies a management operation for relation mapping and miss shaping.
type accessOp int

const (
	opRead accessOp = iota
	opWrite
	opDelete
)

// errResourceGone means path.id has no RSI row. Idempotent deletes map this to 204.
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
// resource-flavored errors the gate answers with.
type resourceAccess struct {
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
	// team.project_not_found matches the service's nonexistent-project answer.
	writeMiss: domain.ErrTeamProjectNotFound,
	denied:    domain.ErrTeamPermissionDenied,
}

// sessionAccess gates operator session get/list/revoke. Create/exchange stay
// on the runtime plane. MVP: same project.write ceiling + project relation
// Check as other management resources (replacing the old fail-closed session.*
// scope gate until #420).
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

// resourceAccessStmts is the statement surface requireResourceAccess needs.
type resourceAccessStmts interface {
	service.AuthzResolverStatements
	service.ResourceScopeStatements
}

// requireResourceAccess resolves path.id via resource_scope_index, then runs
// the project-scoped Check. RSI miss on read/write → resource 404; on delete →
// errResourceGone (handlers map to 204). Returns project_id for DAL calls.
func (h *Handler) requireResourceAccess(ctx context.Context, resourceID string, res resourceAccess, op accessOp) (projectID string, err error) {
	if h == nil || h.pool == nil {
		return "", domain.ErrInternal(nil).WithMessage("authz statements not configured")
	}
	return requireResourceAccess(ctx, h.pool.Statements(), resourceID, res, op)
}

func requireResourceAccess(ctx context.Context, stmts resourceAccessStmts, resourceID string, res resourceAccess, op accessOp) (string, error) {
	scope, err := stmts.GetResourceScope(ctx, resourceID)
	if err != nil {
		if errors.Is(err, new(database.NoRowFoundError)) {
			if op == opDelete {
				return "", errResourceGone
			}
			// Flat-by-id: unknown path id is always the resource 404 shape.
			return "", res.readMiss()
		}
		return "", domain.ErrInternal(err).WithMessage("resource scope lookup failed")
	}
	if err := requireProjectAccess(ctx, stmts, scope.ProjectID, res, op); err != nil {
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
		return domain.ErrInternal(nil).WithMessage("authz statements not configured")
	}
	return requireProjectAccess(ctx, h.pool.Statements(), projectID, res, op)
}

func requireProjectAccess(ctx context.Context, stmts service.AuthzResolverStatements, projectID string, res resourceAccess, op accessOp) error {
	scope, ok := GetScopeContext(ctx)
	if !ok || scope.PrincipalType == "" || scope.PrincipalID == "" {
		return res.miss(op)
	}

	if !hasOperatorProjectWrite(scope.Scope) {
		// Foreign / unbound → anti-oracle miss; same project → denied (preview).
		if scope.ProjectID == "" || scope.ProjectID != projectID {
			return res.miss(op)
		}
		return res.denied()
	}

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

// requireTeamDelete gates deleteTeam via the team's RSI. Unknown teams are
// gone (204). Check denials (including foreign foothold misses) stay
// permission_denied for the historical deleteTeam contract.
func (h *Handler) requireTeamDelete(ctx context.Context, teamID string) (projectID string, err error) {
	projectID, err = h.requireResourceAccess(ctx, teamID, teamAccess, opDelete)
	if err != nil {
		if errors.Is(err, errResourceGone) {
			return "", err
		}
		return "", domain.ErrTeamPermissionDenied().WithParent(err)
	}
	return projectID, nil
}
