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
	// the OpenAPI contract.
	scopes map[accessOp][]string
	// legacyProjectWriteUmbrella temporarily lets the project secret's
	// project.write scope satisfy the finer scopes above. Strict matching is
	// the default and target model; set this only on resources that existing
	// callers cannot reach until ADR 036's credential planes mint their
	// resource-specific scopes.
	legacyProjectWriteUmbrella bool
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
	legacyProjectWriteUmbrella: true,
	readMiss:                   domain.ErrJSONSchemaNotFound,
	writeMiss:                  func() domain.Error { return domain.ErrJSONSchemaInvalid().WithDetails("project does not exist") },
	denied:                     domain.ErrJSONSchemaPermissionDenied,
}

var flowDefinitionAccess = resourceAccess{
	scopes: map[accessOp][]string{
		opRead:   {"flow_definition.read", "flow_definition.write"},
		opWrite:  {"flow_definition.write"},
		opDelete: {"flow_definition.delete"},
	},
	legacyProjectWriteUmbrella: true,
	readMiss:                   domain.ErrFlowDefinitionNotFound,
	writeMiss:                  func() domain.Error { return domain.ErrFlowDefinitionInvalid("project does not exist", nil) },
	denied:                     domain.ErrFlowDefinitionPermissionDenied,
}

var userAccess = resourceAccess{
	scopes: map[accessOp][]string{
		opRead:   {"user.read", "user.write"},
		opWrite:  {"user.write"},
		opDelete: {"user.delete"},
	},
	legacyProjectWriteUmbrella: true,
	readMiss:                   domain.ErrUserNotFound,
	writeMiss:                  func() domain.Error { return domain.ErrUserInvalid().WithDetails("project does not exist") },
	denied:                     domain.ErrUserPermissionDenied,
}

var teamAccess = resourceAccess{
	scopes: map[accessOp][]string{
		opRead:   {"team.read", "team.write"},
		opWrite:  {"team.write"},
		opDelete: {"team.delete"},
	},
	legacyProjectWriteUmbrella: true,
	readMiss:                   domain.ErrTeamNotFound,
	// The team service already answers nonexistent projects with
	// team.project_not_found; foreign projects must be indistinguishable.
	writeMiss: domain.ErrTeamProjectNotFound,
	denied:    domain.ErrTeamPermissionDenied,
}

// sessionAccess gates operator session management (get/list/revoke by id).
// Create and exchange stay on the runtime/app plane and are not checked here.
// Both plural (current OpenAPI) and singular (catalog target) finer scopes are
// accepted so project binding does not depend on the rename landing first.
//
// Strict scope matching is the default. Revoking sessions is an end-user-facing
// runtime act — one call logs a person out, a loop logs out a project — which
// is a different blast radius from editing project configuration, so this row
// does not opt into the legacy project.write umbrella. No credential mints session.*
// today (project secrets carry project.write + project.read, preview secrets
// project.read), so these operator endpoints answer permission_denied until
// ADR 036's credential planes issue the app-plane scopes. Failing closed is
// deliberate: before this guard existed any decryptable token, including the
// browser-shipped preview secret, could revoke any session by id.
var sessionAccess = resourceAccess{
	scopes: map[accessOp][]string{
		opRead:   {"session.read", "sessions.read", "session.write", "sessions.write"},
		opDelete: {"session.delete", "sessions.delete"},
	},
	readMiss:  domain.ErrSessionNotFound,
	writeMiss: domain.ErrSessionNotFound,
	denied:    domain.ErrSessionPermissionDenied,
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
	legacyProjectWriteUmbrella: true,
	readMiss:                   domain.ErrBrandingNotFound,
	writeMiss:                  func() domain.Error { return domain.ErrBrandingInvalid("project does not exist", nil) },
	denied:                     domain.ErrBrandingPermissionDenied,
}

// projectAccess deliberately lists no finer read scope: project.read is the
// preview secret's scope — a browser-plane credential — so it cannot gate an
// operator read. Until ADR 036 splits the schemes, project.write is the only
// scope that reaches project management operations.
var projectAccess = resourceAccess{
	scopes:                     map[accessOp][]string{},
	legacyProjectWriteUmbrella: true,
	readMiss:                   domain.ErrProjectNotFound,
	writeMiss:                  domain.ErrProjectNotFound,
	denied:                     domain.ErrProjectPermissionDenied,
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
	if !res.allows(scope.Scope, op) {
		return res.denied()
	}
	return nil
}

// requireTeamDelete gates deleteTeam. Deleting an unknown team answers 204, so
// the endpoint has no not-found to report: a project the credentials are not
// bound to is refused as the permission failure it is.
func requireTeamDelete(ctx context.Context, projectID string) error {
	if err := requireProjectAccess(ctx, projectID, teamAccess, opDelete); err != nil {
		return domain.ErrTeamPermissionDenied().WithParent(err)
	}
	return nil
}

// allows reports whether the granted scopes reach op on this resource.
// Matching is strict by default; only explicitly marked legacy rows admit the
// project.write umbrella.
func (res resourceAccess) allows(granted []string, op accessOp) bool {
	if res.legacyProjectWriteUmbrella {
		return scopeAllowed(granted, res.scopes[op])
	}
	return scopeListed(granted, res.scopes[op])
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
	}
	return scopeListed(granted, accepted)
}

// scopeListed reports whether a granted scope appears verbatim in accepted,
// without admitting the project.write umbrella.
func scopeListed(granted, accepted []string) bool {
	for _, s := range granted {
		for _, a := range accepted {
			if s == a {
				return true
			}
		}
	}
	return false
}
