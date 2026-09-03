package api

import (
	"context"
	"errors"
	"slices"

	"github.com/zitadel/nextgen/internal/authz/resolver"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// The management API is gated by resolver.Check after credential → ScopeContext.
// Path-id ops resolve RSI then Check; create uses requireProjectAccess.
// Lists use requireProjectListAccess: project-wide Allow stamps a one-shot
// EXISTS skip, Forbidden attaches the predicate, NotFound 404s. Preview secrets
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

// environmentAccess gates the project's runtime slots (ADR 035, #534).
// Reads are project-scoped: the list carries a project_id and the get
// addresses an environment by name, so no route resolves a path id through
// RSI and the kind is only used to narrow a partial-access list.
var environmentAccess = resourceAccess{
	kind:      domain.ResourceKindEnvironment,
	readMiss:  domain.ErrEnvironmentNotFound,
	writeMiss: domain.ErrEnvironmentProjectNotFound,
	denied:    domain.ErrEnvironmentPermissionDenied,
}

// eventsAccess gates the operator audit stream (ADR 049). List/get are
// project-scoped (no RSI kind); credential ceiling is project.write like other
// management resources until #420 mints a fine-grained events relation.
var eventsAccess = resourceAccess{
	readMiss:  domain.ErrEventNotFound,
	writeMiss: domain.ErrEventNotFound,
	denied:    domain.ErrEventPermissionDenied,
}

// grantAccess gates create/get/revoke. Grants are not in resource_scope_index;
// every op takes project_id from the header (same as events).
var grantAccess = resourceAccess{
	readMiss:  domain.ErrGrantNotFound,
	writeMiss: domain.ErrGrantNotFound,
	denied:    domain.ErrGrantPermissionDenied,
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
			if same, gerr := stmts.GetResourceScopeByIDInProject(ctx, cred.ProjectID, resourceID); gerr == nil {
				return same, nil
			} else if !errors.Is(gerr, new(database.NoRowFoundError)) {
				return nil, gerr
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
					// Idempotent 204 only when the id is gone everywhere. Foreign
					// presence (any other project) must not 204 — readMiss matches
					// Check NotFound for a foreign sk_proj.
					elsewhere, xerr := stmts.ExistsResourceScopeElsewhere(ctx, res.kind, resourceID, cred.ProjectID)
					if xerr != nil {
						return "", domain.ErrInternal(xerr).WithMessage("resource scope lookup failed")
					}
					if elsewhere {
						return "", res.readMiss()
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
	if err := requireProjectAccessAfterRSI(ctx, stmts, scope, res, op); err != nil {
		return "", err
	}
	return scope.ProjectID, nil
}

// requireProjectAccess gates a management operation via resolver.Check when
// project_id is already known (create, project by-id, or after RSI).
// Management lists use requireProjectListAccess, not this gate.
// DecisionNotFound → resource not-found / invalid-project shapes (404).
// DecisionForbidden → permission_denied (403).
func (h *Handler) requireProjectAccess(ctx context.Context, projectID string, res resourceAccess, op accessOp) error {
	if h == nil || h.pool == nil {
		return domain.ErrInternal(errors.New("authz statements not configured"))
	}
	return requireProjectAccess(ctx, h.pool.Statements(), projectID, res, op)
}

func requireProjectAccess(ctx context.Context, stmts service.AuthzResolverStatements, projectID string, res resourceAccess, op accessOp) error {
	return requireProjectAccessMapped(ctx, stmts, projectID, res, op, nil)
}

// requireProjectAccessAfterRSI is requireProjectAccess for by-id ops after an
// RSI hit: DecisionNotFound always uses readMiss (not writeMiss) so PATCH routes
// do not leak existence via mismatched codes. Team-/resource-scoped grants may
// Allow when RSI.team_id / path id match the grant (authz.md scoped Allow).
func requireProjectAccessAfterRSI(ctx context.Context, stmts service.AuthzResolverStatements, rsi *domain.ResourceScope, res resourceAccess, op accessOp) error {
	return requireProjectAccessMapped(ctx, stmts, rsi.ProjectID, res, op, rsi)
}

func requireProjectAccessMapped(ctx context.Context, stmts service.AuthzResolverStatements, projectID string, res resourceAccess, op accessOp, rsi *domain.ResourceScope) error {
	dec, err := checkProjectAccess(ctx, resolver.New(), stmts, projectID, op, rsi)
	if err != nil {
		return mapCeilingError(err, res, op, rsi)
	}
	if rsi != nil {
		return mapAuthzDecisionAfterRSI(dec, res)
	}
	return mapAuthzDecision(dec, res, op)
}

var (
	errAuthzNoScope       = errors.New("authz: missing credential scope")
	errAuthzPreviewDenied = errors.New("authz: preview credential denied")
)

func mapCeilingError(err error, res resourceAccess, op accessOp, rsi *domain.ResourceScope) error {
	switch {
	case errors.Is(err, errAuthzNoScope):
		if rsi != nil {
			return res.readMiss()
		}
		return res.miss(op)
	case errors.Is(err, errAuthzPreviewDenied):
		return res.denied()
	default:
		return err
	}
}

func projectCheckRequest(scope ScopeContext, projectID string, op accessOp, rsi *domain.ResourceScope) resolver.Request {
	req := resolver.Request{
		PrincipalType: scope.PrincipalType,
		PrincipalID:   scope.PrincipalID,
		ProjectID:     projectID,
		HomeProjectID: scope.ProjectID,
		ObjectType:    "project",
		Relation:      projectRelation(op),
		TeamID:        scope.TeamID,
	}
	if rsi != nil {
		req.ResourceID = rsi.ResourceID
		if rsi.TeamID != nil {
			req.ResourceTeamID = *rsi.TeamID
		}
	}
	return req
}

// checkProjectAccess runs the credential ceiling then resolver.Check.
// Ceiling failures are errAuthzNoScope / errAuthzPreviewDenied; Check
// failures are already domain.ErrInternal.
func checkProjectAccess(ctx context.Context, r *resolver.Resolver, stmts service.AuthzResolverStatements, projectID string, op accessOp, rsi *domain.ResourceScope) (resolver.Decision, error) {
	scope, ok := GetScopeContext(ctx)
	if !ok || scope.PrincipalType == "" || scope.PrincipalID == "" {
		return resolver.DecisionUnspecified, errAuthzNoScope
	}
	if err := credentialCeiling(scope, projectID); err != nil {
		return resolver.DecisionUnspecified, err
	}
	dec, err := r.Check(ctx, stmts, projectCheckRequest(scope, projectID, op, rsi))
	if err != nil {
		return resolver.DecisionUnspecified, domain.ErrInternal(err).WithMessage("authz permission check failed")
	}
	return dec, nil
}

// credentialCeiling is the pre-resolver gate on the credential plane.
// Project secrets still need project.write (preview stays denied). User
// principals skip that ceiling; resolver.Check decides Allow / Forbidden /
// NotFound (ADR 053 §5).
func credentialCeiling(scope ScopeContext, targetProjectID string) error {
	if scope.PrincipalType == domain.AuthzPrincipalTypeUser {
		if scope.ProjectID == "" {
			return errAuthzNoScope
		}
		return nil
	}
	if !hasOperatorProjectWrite(scope.Scope) {
		// Foreign / unbound → anti-oracle miss; same project → denied (preview).
		if scope.ProjectID == "" || scope.ProjectID != targetProjectID {
			return errAuthzNoScope
		}
		return errAuthzPreviewDenied
	}
	return nil
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

// requireMembershipRead gates the membership reads — `expand: ["teams"]` and a
// `team_id` filter on the users query, and GET /users/{user_id}/teams — because
// reading users is not reading team memberships (system-permission-catalog.md).
//
// The operator fallback is interim: no token carries team_membership.read yet
// (ADR 036), so requiring it outright would reject every caller.
// TODO(#420): drop it once granular scopes are minted.
func requireMembershipRead(ctx context.Context) error {
	scope, ok := GetScopeContext(ctx)
	if ok && (slices.Contains(scope.Scope, "team_membership.read") || hasOperatorProjectWrite(scope.Scope)) {
		return nil
	}
	// The sentinel's own message names the project secret, which is not what
	// this gate is about; WithMessage keeps the code so errors.Is still matches.
	return domain.ErrUserPermissionDenied().
		WithMessage("reading a user's team memberships requires team_membership.read")
}

// requireTeamRead gates `expand: ["lifecycle_owner_team"]` on the users query.
// The id is already on every user; resolving it to the team's name and status
// reads the team resource, which user.read does not cover
// (system-permission-catalog.md).
//
// Same interim fallback as requireMembershipRead, for the same reason: team.read
// is not minted yet (ADR 036). TODO(#420): drop it once granular scopes are.
func requireTeamRead(ctx context.Context) error {
	scope, ok := GetScopeContext(ctx)
	if ok && (slices.Contains(scope.Scope, "team.read") || hasOperatorProjectWrite(scope.Scope)) {
		return nil
	}
	return domain.ErrUserPermissionDenied().
		WithMessage("expanding a user's lifecycle owner team requires team.read")
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

// requireProjectListAccess gates a management list and attaches the list
// context: Allow stamps a one-shot EXISTS skip (consumed by the next
// compileList / ListUsers); Forbidden attaches the EXISTS predicate via
// the same Resolver used for Check; NotFound 404s.
func (h *Handler) requireProjectListAccess(ctx context.Context, projectID string, res resourceAccess, kind domain.ResourceKind) (context.Context, error) {
	if h == nil || h.pool == nil {
		return ctx, domain.ErrInternal(errors.New("authz statements not configured"))
	}
	return requireProjectListAccess(ctx, h.pool.Statements(), projectID, res, kind)
}

func requireProjectListAccess(ctx context.Context, stmts service.AuthzResolverStatements, projectID string, res resourceAccess, kind domain.ResourceKind) (context.Context, error) {
	r := resolver.New()
	dec, err := checkProjectAccess(ctx, r, stmts, projectID, opRead, nil)
	if err != nil {
		return ctx, mapCeilingError(err, res, opRead, nil)
	}
	switch dec {
	case resolver.DecisionAllow:
		return service.WithAuthzListSkipOnce(ctx), nil
	case resolver.DecisionForbidden:
		return withAuthzListFilter(ctx, r, stmts, projectID, kind, opRead)
	case resolver.DecisionNotFound, resolver.DecisionUnspecified:
		return ctx, res.miss(opRead)
	default:
		return ctx, res.miss(opRead)
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

// withAuthzListFilter attaches the EXISTS list predicate using the same
// CheckParams builder as resolver.Check (including ConstraintTeamID).
func withAuthzListFilter(ctx context.Context, r *resolver.Resolver, stmts service.AuthzResolverStatements, projectID string, kind domain.ResourceKind, op accessOp) (context.Context, error) {
	scope, ok := GetScopeContext(ctx)
	if !ok || scope.PrincipalType == "" || scope.PrincipalID == "" {
		return ctx, domain.ErrInternal(nil).WithMessage("authz list filter requires credential scope")
	}
	params, err := r.CheckParams(ctx, stmts, projectCheckRequest(scope, projectID, op, nil))
	if err != nil {
		return ctx, domain.ErrInternal(err).WithMessage("authz catalog lookup failed")
	}
	return service.WithAuthzListFilter(ctx, service.AuthzListFilter{
		AuthzCheckParams: params,
		ResourceKind:     kind,
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
