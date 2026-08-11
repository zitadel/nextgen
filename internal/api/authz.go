package api

import (
	"context"

	"github.com/zitadel/nextgen/internal/authz/resolver"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// The management API (the operator plane of ADR 036: schemas, flow
// definitions, users, teams, project queries) is gated by the authz
// permission resolver after credential → resolved project scope.
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

// requireProjectAccess gates a management operation via resolver.Check.
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
		PrincipalType: scope.PrincipalType,
		PrincipalID:   scope.PrincipalID,
		ProjectID:     projectID,
		ObjectType:    "project",
		Relation:      relation,
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

// requireUserTeamsAccess gates listUserTeams, which is a read of two resources
// at once: the membership rows belong to the user, and each entry carries the
// team's name. Both reads are required rather than either.
func (h *Handler) requireUserTeamsAccess(ctx context.Context, projectID string) error {
	if err := h.requireProjectAccess(ctx, projectID, userAccess, opRead); err != nil {
		return err
	}
	return h.requireProjectAccess(ctx, projectID, teamAccess, opRead)
}

// requireTeamDelete gates deleteTeam. Deleting an unknown team answers 204, so
// the endpoint has no not-found to report: a project the credentials are not
// authorized for is refused as the permission failure it is when foothold
// exists; no foothold stays a not-found-shaped miss mapped through denied for
// delete (see requireTeamDelete historical contract).
func (h *Handler) requireTeamDelete(ctx context.Context, projectID string) error {
	if err := h.requireProjectAccess(ctx, projectID, teamAccess, opDelete); err != nil {
		// Preserve deleteTeam's permission_denied wrapper for any denial.
		return domain.ErrTeamPermissionDenied().WithParent(err)
	}
	return nil
}
