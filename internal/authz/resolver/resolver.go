package resolver

import (
	"context"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// Request is the public Check input. The active system catalog is resolved
// internally; callers must not supply a catalog id.
type Request struct {
	PrincipalType domain.AuthzPrincipalType
	PrincipalID   string
	ProjectID     string
	ObjectType    string
	Relation      string
	// TeamID is required for sk_team_ principals (token team). Copied to
	// AuthzCheckParams.ConstraintTeamID so SQL can constrain the object.
	TeamID string
	// ResourceID is the object being checked (user id, team id, path id).
	// Optional for permission-level Check of non-team-bound types; required for
	// sk_team checks of team-bound object types so the compensating team
	// constraint cannot be skipped. Also used for resource-scoped grant arms.
	// Empty ResourceID does not skip the grant Check — it only skips the extra
	// "object is in the token team" AND — so omission would look like a
	// create-style Check. Missing id is an error, not Allow.
	ResourceID string
	// ResourceTeamID is RSI.team_id after a by-id lookup (team-scoped grant arm).
	ResourceTeamID string
	// HomeProjectID is the credential's home project for membership-edge
	// lookup (#333 / ADR 052). Empty stays empty — CheckParams does not
	// default it to ProjectID (the target). SQL still falls back via
	// AuthzCheckParams.HomeProjectID() when unset.
	HomeProjectID string
	// PlatformProjectID is the deployment's platform project, set by the
	// gate when the credential is a user homed there (ADR 075). It adds the
	// platform operator path; empty leaves it out.
	PlatformProjectID string
}

// ListRequest is the public ListObjects input (L4 / oracle helper).
type ListRequest struct {
	Request
	ResourceKind domain.ResourceKind
}

// memoKey is the request-scoped Check cache key. A struct key avoids
// delimiter aliasing that string joins can introduce.
type memoKey struct {
	PrincipalType     domain.AuthzPrincipalType
	PrincipalID       string
	ProjectID         string
	ObjectType        string
	Relation          string
	TeamID            string
	ResourceID        string
	ResourceTeamID    string
	HomeProjectID     string
	PlatformProjectID string
}

// outcome is one memoized Check: the decision and the path that allowed it.
type outcome struct {
	decision Decision
	path     Path
}

// Resolver evaluates checks with optional request-scoped memoization.
// Create one per request; it is not safe for concurrent use.
type Resolver struct {
	catalogID string
	memo      map[memoKey]outcome
}

// New returns a request-scoped resolver.
func New() *Resolver {
	return &Resolver{memo: make(map[memoKey]outcome)}
}

// Check returns Allow / NotFound / Forbidden for one permission check.
//
// For sk_team_ principals, permissions outside the flat allowlist short-circuit
// to DecisionNotFound without a foothold lookup (intentional masking; HTTP will
// map like other NotFound). Allowed permissions still use storage Allow /
// Forbidden / NotFound as usual.
func (r *Resolver) Check(ctx context.Context, stmts service.AuthzResolverStatements, req Request) (Decision, error) {
	d, _, err := r.CheckPath(ctx, stmts, req)
	return d, err
}

// CheckPath is Check that also reports the path that allowed (ADR 053 §8).
//
// The protected project's grants answer first. Only when they do not allow,
// and req names a user homed in the platform project, does the platform
// operator path get a say (ADR 075 §3). It allows outright: an operator
// administers every project, so it never turns a denial into a foothold.
func (r *Resolver) CheckPath(ctx context.Context, stmts service.AuthzResolverStatements, req Request) (Decision, Path, error) {
	if err := validateCheckRequest(req); err != nil {
		return DecisionUnspecified, PathNone, err
	}
	if err := requireSKTeamTeamBoundResourceID(req); err != nil {
		return DecisionUnspecified, PathNone, err
	}
	if req.PrincipalType == domain.AuthzPrincipalTypeSKTeam &&
		!skTeamPermissionAllowed(PermissionName(req.ObjectType, req.Relation)) {
		return DecisionNotFound, PathNone, nil
	}

	key := memoKey{
		PrincipalType:     req.PrincipalType,
		PrincipalID:       req.PrincipalID,
		ProjectID:         req.ProjectID,
		ObjectType:        req.ObjectType,
		Relation:          req.Relation,
		TeamID:            req.TeamID,
		ResourceID:        req.ResourceID,
		ResourceTeamID:    req.ResourceTeamID,
		HomeProjectID:     req.HomeProjectID,
		PlatformProjectID: req.PlatformProjectID,
	}
	if o, ok := r.memo[key]; ok {
		return o.decision, o.path, nil
	}

	catalogID, err := r.ActiveCatalogID(ctx, stmts)
	if err != nil {
		return DecisionUnspecified, PathNone, err
	}

	params := checkParams(catalogID, req)
	allowed, foothold, err := stmts.CheckAuthz(ctx, params)
	if err != nil {
		return DecisionUnspecified, PathNone, err
	}
	o := outcome{decision: DecisionNotFound}
	switch {
	case allowed:
		o = outcome{decision: DecisionAllow, path: PathGrant}
	default:
		operator, err := platformOperatorAllows(ctx, stmts, params)
		if err != nil {
			return DecisionUnspecified, PathNone, err
		}
		switch {
		case operator:
			o = outcome{decision: DecisionAllow, path: PathPlatformOperator}
		case foothold:
			o = outcome{decision: DecisionForbidden}
		}
	}
	r.memo[key] = o
	return o.decision, o.path, nil
}

// PlatformOperator reports whether req's principal holds ObjectType.Relation on
// every object through the platform operator relation (ADR 075 §3). It is the
// question asked without a target: whether a session may search every project,
// and which platform relations the Console shows. ProjectID is not consulted.
func (r *Resolver) PlatformOperator(ctx context.Context, stmts service.AuthzResolverStatements, req Request) (bool, error) {
	switch {
	case req.PrincipalType == "":
		return false, fmt.Errorf("resolver: principal type is required")
	case req.PrincipalID == "":
		return false, fmt.Errorf("resolver: principal id is required")
	case req.ObjectType == "":
		return false, fmt.Errorf("resolver: object type is required")
	case req.Relation == "":
		return false, fmt.Errorf("resolver: relation is required")
	}
	params := checkParams("", req)
	if !params.PlatformOperatorEligible() {
		return false, nil
	}
	catalogID, err := r.ActiveCatalogID(ctx, stmts)
	if err != nil {
		return false, err
	}
	params.CatalogID = catalogID
	return platformOperatorAllows(ctx, stmts, params)
}

// platformOperatorAllows asks storage for the operator path, but only for a
// principal that can hold it: everyone else is answered without a query.
func platformOperatorAllows(ctx context.Context, stmts service.AuthzResolverStatements, params domain.AuthzCheckParams) (bool, error) {
	if !params.PlatformOperatorEligible() {
		return false, nil
	}
	return stmts.CheckPlatformOperator(ctx, params.PlatformCheckParams())
}

// ListObjects returns resource_scope_index ids of ResourceKind the principal may see.
func (r *Resolver) ListObjects(ctx context.Context, stmts service.AuthzResolverStatements, req ListRequest) ([]string, error) {
	if err := validateCheckRequest(req.Request); err != nil {
		return nil, err
	}
	if req.ResourceKind == "" {
		return nil, fmt.Errorf("resolver: resource kind is required")
	}
	if req.PrincipalType == domain.AuthzPrincipalTypeSKTeam &&
		!skTeamPermissionAllowed(PermissionName(req.ObjectType, req.Relation)) {
		return []string{}, nil
	}
	catalogID, err := r.ActiveCatalogID(ctx, stmts)
	if err != nil {
		return nil, err
	}
	return stmts.ListAuthzObjectIDs(ctx, domain.AuthzListObjectsParams{
		AuthzCheckParams: checkParams(catalogID, req.Request),
		ResourceKind:     req.ResourceKind,
	})
}

// CheckParams is the storage Check/List payload for req, including
// ConstraintTeamID for sk_team principals. HTTP list filters must use this
// so EXISTS SQL matches Check.
//
// CheckParams does not apply the sk_team allowlist short-circuit that Check
// uses. sk_team Checks of project.viewer are DecisionNotFound, so HTTP lists
// never take the Forbidden / filter branch for those principals. ConstraintTeamID
// plumbing stays so a future allowlisted project relation still constrains SQL.
func (r *Resolver) CheckParams(ctx context.Context, stmts service.AuthzResolverStatements, req Request) (domain.AuthzCheckParams, error) {
	catalogID, err := r.ActiveCatalogID(ctx, stmts)
	if err != nil {
		return domain.AuthzCheckParams{}, err
	}
	return checkParams(catalogID, req), nil
}

func checkParams(catalogID string, req Request) domain.AuthzCheckParams {
	// Home vs target: HomeProjectID is the credential project; ProjectID is
	// the protected resource's project. Do not default home to target here
	// (#333 / ADR 052).
	p := domain.AuthzCheckParams{
		CatalogID:              catalogID,
		ProjectID:              req.ProjectID,
		PrincipalHomeProjectID: req.HomeProjectID,
		PrincipalType:          req.PrincipalType,
		PrincipalID:            req.PrincipalID,
		ObjectType:             req.ObjectType,
		Relation:               req.Relation,
		ResourceID:             req.ResourceID,
		ResourceTeamID:         req.ResourceTeamID,
		PlatformProjectID:      req.PlatformProjectID,
	}
	if req.PrincipalType == domain.AuthzPrincipalTypeSKTeam {
		p.ConstraintTeamID = req.TeamID
	}
	return p
}

func (r *Resolver) ActiveCatalogID(ctx context.Context, stmts service.AuthzResolverStatements) (string, error) {
	if r.catalogID != "" {
		return r.catalogID, nil
	}
	id, err := stmts.ActiveSystemCatalogID(ctx)
	if err != nil {
		return "", err
	}
	r.catalogID = id
	return id, nil
}

func validateCheckRequest(req Request) error {
	switch {
	case req.PrincipalType == "":
		return fmt.Errorf("resolver: principal type is required")
	case req.PrincipalID == "":
		return fmt.Errorf("resolver: principal id is required")
	case req.ProjectID == "":
		return fmt.Errorf("resolver: project id is required")
	case req.ObjectType == "":
		return fmt.Errorf("resolver: object type is required")
	case req.Relation == "":
		return fmt.Errorf("resolver: relation is required")
	case req.PrincipalType == domain.AuthzPrincipalTypeSKTeam && req.TeamID == "":
		return fmt.Errorf("resolver: team id is required for sk_team")
	default:
		return nil
	}
}

func requireSKTeamTeamBoundResourceID(req Request) error {
	if req.PrincipalType == domain.AuthzPrincipalTypeSKTeam &&
		domain.TeamBoundObjectType(req.ObjectType) &&
		req.ResourceID == "" {
		return fmt.Errorf("resolver: resource id is required for sk_team team-bound checks")
	}
	return nil
}
