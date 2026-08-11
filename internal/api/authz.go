package api

import (
	"context"
	"errors"

	"github.com/zitadel/nextgen/internal/authz/resolver"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// The management API (operator plane: schemas, flow definitions, users, teams,
// project queries, branding, operator sessions) is gated by resolver.Check after
// credential → ScopeContext. MVP uses coarse project.{viewer,editor,admin}
// (#420 expands to fine-grained catalog relations). Preview secrets
// (project.read only) cannot call management APIs (ADR 037).

// accessOp classifies a management operation for relation mapping and miss shaping.
type accessOp int

const (
	opRead accessOp = iota
	opWrite
	opDelete
)

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
	// readMiss / writeMiss are anti-oracle answers when the principal has no
	// foothold; writeMiss also covers nonexistent projects.
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

// requireProjectAccess gates a management operation via resolver.Check.
// DecisionNotFound → resource not-found / invalid-project shapes (404).
// DecisionForbidden → permission_denied (403).
func (h *Handler) requireProjectAccess(ctx context.Context, projectID string, res resourceAccess, op accessOp) error {
	if h == nil || h.pool == nil {
		return domain.ErrInternal(errors.New("authz statements not configured"))
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

// requireUserTeamsAccess gates listUserTeams. Under coarse project.viewer the
// Check is identical for user and team; keep the user miss shape (documented 404).
func (h *Handler) requireUserTeamsAccess(ctx context.Context, projectID string) error {
	return h.requireProjectAccess(ctx, projectID, userAccess, opRead)
}

// requireTeamDelete gates deleteTeam. Unknown teams answer 204, so every denial
// (including foreign-project not-found shapes) is wrapped as permission_denied.
func (h *Handler) requireTeamDelete(ctx context.Context, projectID string) error {
	if err := h.requireProjectAccess(ctx, projectID, teamAccess, opDelete); err != nil {
		return domain.ErrTeamPermissionDenied().WithParent(err)
	}
	return nil
}
