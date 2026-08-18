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
}

// ListRequest is the public ListObjects input (L4 / oracle helper).
type ListRequest struct {
	Request
	ResourceKind domain.ResourceKind
}

// memoKey is the request-scoped Check cache key. A struct key avoids
// delimiter aliasing that string joins can introduce.
type memoKey struct {
	PrincipalType domain.AuthzPrincipalType
	PrincipalID   string
	ProjectID     string
	ObjectType    string
	Relation      string
}

// Resolver evaluates checks with optional request-scoped memoization.
// Create one per request; it is not safe for concurrent use.
type Resolver struct {
	catalogID string
	memo      map[memoKey]Decision
}

// New returns a request-scoped resolver.
func New() *Resolver {
	return &Resolver{memo: make(map[memoKey]Decision)}
}

// Check returns Allow / NotFound / Forbidden for one permission check.
//
// For sk_team_ principals, permissions outside the flat allowlist short-circuit
// to DecisionNotFound without a foothold lookup (intentional masking; HTTP will
// map like other NotFound). Allowed permissions still use storage Allow /
// Forbidden / NotFound as usual.
func (r *Resolver) Check(ctx context.Context, stmts service.AuthzResolverStatements, req Request) (Decision, error) {
	if err := validateCheckRequest(req); err != nil {
		return DecisionUnspecified, err
	}
	if req.PrincipalType == domain.AuthzPrincipalTypeSKTeam &&
		!skTeamPermissionAllowed(PermissionName(req.ObjectType, req.Relation)) {
		return DecisionNotFound, nil
	}

	key := memoKey{
		PrincipalType: req.PrincipalType,
		PrincipalID:   req.PrincipalID,
		ProjectID:     req.ProjectID,
		ObjectType:    req.ObjectType,
		Relation:      req.Relation,
	}
	if d, ok := r.memo[key]; ok {
		return d, nil
	}

	catalogID, err := r.activeCatalogID(ctx, stmts)
	if err != nil {
		return DecisionUnspecified, err
	}

	allowed, foothold, err := stmts.CheckAuthz(ctx, domain.AuthzCheckParams{
		CatalogID:              catalogID,
		ProjectID:              req.ProjectID,
		PrincipalHomeProjectID: req.ProjectID,
		PrincipalType:          req.PrincipalType,
		PrincipalID:            req.PrincipalID,
		ObjectType:             req.ObjectType,
		Relation:               req.Relation,
	})
	if err != nil {
		return DecisionUnspecified, err
	}
	d := DecisionNotFound
	switch {
	case allowed:
		d = DecisionAllow
	case foothold:
		d = DecisionForbidden
	}
	r.memo[key] = d
	return d, nil
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
	catalogID, err := r.activeCatalogID(ctx, stmts)
	if err != nil {
		return nil, err
	}
	return stmts.ListAuthzObjectIDs(ctx, domain.AuthzListObjectsParams{
		AuthzCheckParams: domain.AuthzCheckParams{
			CatalogID:              catalogID,
			ProjectID:              req.ProjectID,
			PrincipalHomeProjectID: req.ProjectID,
			PrincipalType:          req.PrincipalType,
			PrincipalID:            req.PrincipalID,
			ObjectType:             req.ObjectType,
			Relation:               req.Relation,
		},
		ResourceKind: req.ResourceKind,
	})
}

func (r *Resolver) activeCatalogID(ctx context.Context, stmts service.AuthzResolverStatements) (string, error) {
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
	default:
		return nil
	}
}
