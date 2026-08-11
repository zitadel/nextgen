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

// ListRequest is the public ListObjects input.
type ListRequest struct {
	PrincipalType domain.AuthzPrincipalType
	PrincipalID   string
	ProjectID     string
	ResourceKind  domain.ResourceKind
	ObjectType    string
	Relation      string
}

// Resolver evaluates checks with optional request-scoped memoization.
// Create one per request; it is not safe for concurrent use.
type Resolver struct {
	catalogID string
	memo      map[string]Decision
}

// New returns a request-scoped resolver.
func New() *Resolver {
	return &Resolver{memo: make(map[string]Decision)}
}

// Check returns Allow / NotFound / Forbidden for one permission check.
func (r *Resolver) Check(ctx context.Context, stmts service.AuthzResolverStatements, req Request) (Decision, error) {
	if err := validateCheckRequest(req); err != nil {
		return DecisionUnspecified, err
	}
	if req.PrincipalType == domain.AuthzPrincipalTypeSKTeam &&
		!skTeamPermissionAllowed(PermissionName(req.ObjectType, req.Relation)) {
		return DecisionNotFound, nil
	}

	key := checkMemoKey(req)
	if d, ok := r.memo[key]; ok {
		return d, nil
	}

	catalogID, err := r.activeCatalogID(ctx, stmts)
	if err != nil {
		return DecisionUnspecified, err
	}

	allowed, err := stmts.CheckAuthz(ctx, domain.AuthzCheckParams{
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
	if allowed {
		r.memo[key] = DecisionAllow
		return DecisionAllow, nil
	}

	foothold, err := stmts.HasAuthzProjectFoothold(ctx, req.ProjectID, req.PrincipalType, req.PrincipalID)
	if err != nil {
		return DecisionUnspecified, err
	}
	d := DecisionNotFound
	if foothold {
		d = DecisionForbidden
	}
	r.memo[key] = d
	return d, nil
}

// ListObjects returns resource_scope_index ids of ResourceKind the principal may see.
func (r *Resolver) ListObjects(ctx context.Context, stmts service.AuthzResolverStatements, req ListRequest) ([]string, error) {
	if err := validateListRequest(req); err != nil {
		return nil, err
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
		CatalogID:              catalogID,
		ProjectID:              req.ProjectID,
		PrincipalHomeProjectID: req.ProjectID,
		PrincipalType:          req.PrincipalType,
		PrincipalID:            req.PrincipalID,
		ResourceKind:           req.ResourceKind,
		ObjectType:             req.ObjectType,
		Relation:               req.Relation,
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

func checkMemoKey(req Request) string {
	return fmt.Sprintf("%s|%s|%s|%s|%s",
		req.PrincipalType, req.PrincipalID, req.ProjectID, req.ObjectType, req.Relation)
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

func validateListRequest(req ListRequest) error {
	switch {
	case req.PrincipalType == "":
		return fmt.Errorf("resolver: principal type is required")
	case req.PrincipalID == "":
		return fmt.Errorf("resolver: principal id is required")
	case req.ProjectID == "":
		return fmt.Errorf("resolver: project id is required")
	case req.ResourceKind == "":
		return fmt.Errorf("resolver: resource kind is required")
	case req.ObjectType == "":
		return fmt.Errorf("resolver: object type is required")
	case req.Relation == "":
		return fmt.Errorf("resolver: relation is required")
	default:
		return nil
	}
}
