package api

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
)

// The management API (the operator plane of ADR 036: schemas, flow
// definitions, users, teams, project queries) is uniformly strict, following
// the access model settled for branding in ADR 037: every operation requires
// a bearer bound to the requested project, carrying a management-grade scope.
//
// Two properties fall out of the single binding check below:
//
//   - Anti-oracle responses. A foreign project — existing or not — answers
//     exactly like a nonexistent one, because both fail the same
//     "requested == token's project" comparison. Callers cannot probe which
//     project ids exist.
//   - The browser plane is excluded. The preview secret ships to visitors'
//     browsers by design and carries project.read only; no management
//     operation accepts it, so a leaked preview token cannot read or write
//     management state — not even on its own project.

// accessOp classifies a management operation for scope checking. Delete is
// distinct from write because the contract declares *.delete scopes
// separately (flow_definition.delete); write does not imply delete.
type accessOp int

const (
	opRead accessOp = iota
	opWrite
	opDelete
)

// resourceAccess is one resource's row in the management access model: which
// finer scopes grant which operation, and the resource-flavored errors the
// guard answers with. The error split follows requireBrandingAccess: reads
// miss with the resource's not-found, writes with its nonexistent-project
// answer, and scope failures are permission_denied (mapped to 403 by the
// resource's errorResponse switch).
type resourceAccess struct {
	// scopes lists, per operation, the finer per-resource scopes declared in
	// the OpenAPI contract (which become mintable with ADR 036's credential
	// planes; until then the legacy operator-grade project.write implies all
	// of them and is accepted everywhere without being listed here).
	scopes map[accessOp][]string
	// readMiss and writeMiss are the anti-oracle answers for a project the
	// token is not bound to; writeMiss doubles as the nonexistent-project
	// answer since the guard cannot (and must not) tell the two apart.
	readMiss  func() domain.Error
	writeMiss func() domain.Error
	denied    func() domain.Error
}

var schemaAccess = resourceAccess{
	scopes: map[accessOp][]string{
		opRead:  {"schema.read", "schema.write"},
		opWrite: {"schema.write"},
	},
	readMiss:  domain.ErrJSONSchemaNotFound,
	writeMiss: func() domain.Error { return domain.ErrJSONSchemaInvalid().WithDetails("project does not exist") },
	denied:    domain.ErrJSONSchemaPermissionDenied,
}

var flowDefinitionAccess = resourceAccess{
	scopes: map[accessOp][]string{
		opRead:   {"flow_definition.read", "flow_definition.write"},
		opWrite:  {"flow_definition.write"},
		opDelete: {"flow_definition.delete"},
	},
	readMiss:  domain.ErrFlowDefinitionNotFound,
	writeMiss: func() domain.Error { return domain.ErrFlowDefinitionInvalid("project does not exist", nil) },
	denied:    domain.ErrFlowDefinitionPermissionDenied,
}

var userAccess = resourceAccess{
	scopes: map[accessOp][]string{
		opRead:   {"user.read", "user.write"},
		opWrite:  {"user.write"},
		opDelete: {"user.delete"},
	},
	readMiss:  domain.ErrUserNotFound,
	writeMiss: func() domain.Error { return domain.ErrUserInvalid().WithDetails("project does not exist") },
	denied:    domain.ErrUserPermissionDenied,
}

var teamAccess = resourceAccess{
	scopes: map[accessOp][]string{
		opRead:  {"team.read", "team.write"},
		opWrite: {"team.write"},
	},
	readMiss: domain.ErrTeamNotFound,
	// The team service already answers nonexistent projects with
	// team.project_not_found; foreign projects must be indistinguishable.
	writeMiss: domain.ErrTeamProjectNotFound,
	denied:    domain.ErrTeamPermissionDenied,
}

// brandingAccess is the row this access model was generalized from (ADR 040,
// "Access model"): managing templates and rendering them during login are
// different planes, and the login path never calls the branding management
// API — branding arrives inline on flow responses.
var brandingAccess = resourceAccess{
	scopes: map[accessOp][]string{
		opRead:  {"branding.read", "branding.write"},
		opWrite: {"branding.write"},
	},
	readMiss:  domain.ErrBrandingNotFound,
	writeMiss: func() domain.Error { return domain.ErrBrandingInvalid("project does not exist", nil) },
	denied:    domain.ErrBrandingPermissionDenied,
}

// projectAccess deliberately lists no finer read scope: project.read is the
// preview secret's scope — a browser-plane credential — so it cannot gate an
// operator read. Until ADR 036 splits the schemes, project.write is the only
// scope that reaches project management operations.
var projectAccess = resourceAccess{
	scopes:    map[accessOp][]string{},
	readMiss:  domain.ErrProjectNotFound,
	writeMiss: domain.ErrProjectNotFound,
	denied:    domain.ErrProjectPermissionDenied,
}

// requireProjectAccess gates a management operation: the bearer must be bound
// to the requested project and carry a management-grade scope for op. See the
// package comment above for the two properties this construction guarantees.
func requireProjectAccess(ctx context.Context, projectID string, res resourceAccess, op accessOp) error {
	scope, ok := GetScopeContext(ctx)
	if !ok || scope.ProjectID == "" || scope.ProjectID != projectID {
		// opWrite ops (create, update, set-password — every mutation except
		// delete) answer with the resource's invalid-project shape; reads and
		// deletes answer "nothing there", matching what a read or delete of
		// an unknown id inside your own project returns.
		if op == opWrite {
			return res.writeMiss()
		}
		return res.readMiss()
	}
	if !scopeAllowed(scope.Scope, res.scopes[op]) {
		return res.denied()
	}
	return nil
}

// scopeAllowed reports whether any granted scope reaches the operation:
// project.write is the operator-grade legacy scope every project secret
// carries and implies every finer per-resource scope; accepted lists the
// contract-declared finer scopes for this specific operation.
func scopeAllowed(granted, accepted []string) bool {
	for _, s := range granted {
		if s == "project.write" {
			return true
		}
		for _, a := range accepted {
			if s == a {
				return true
			}
		}
	}
	return false
}
