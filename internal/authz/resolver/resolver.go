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

// ResourceColumns names the resource-table columns that carry scope ids for
// list-predicate injection. ListObjects uses resource_scope_index; list SQL
// correlates via ResourceIDCol (and ProjectIDCol for the outer project filter).
type ResourceColumns struct {
	ProjectIDCol  string
	TeamIDCol     string // empty when the resource is project-scoped only
	ResourceIDCol string
}

// ColumnsFor returns the registered column names for a resource kind.
func ColumnsFor(kind domain.ResourceKind) (ResourceColumns, bool) {
	cols, ok := resourceColumns[kind]
	return cols, ok
}

var resourceColumns = map[domain.ResourceKind]ResourceColumns{
	domain.ResourceKindUser: {
		ProjectIDCol: "project_id", TeamIDCol: "", ResourceIDCol: "id",
	},
	domain.ResourceKindTeam: {
		ProjectIDCol: "project_id", TeamIDCol: "id", ResourceIDCol: "id",
	},
	domain.ResourceKindSchema: {
		ProjectIDCol: "project_id", TeamIDCol: "", ResourceIDCol: "url",
	},
	domain.ResourceKindBranding: {
		ProjectIDCol: "project_id", TeamIDCol: "", ResourceIDCol: "id",
	},
	domain.ResourceKindFlowDefinition: {
		ProjectIDCol: "project_id", TeamIDCol: "", ResourceIDCol: "id",
	},
	domain.ResourceKindSession: {
		ProjectIDCol: "project_id", TeamIDCol: "", ResourceIDCol: "id",
	},
	domain.ResourceKindProject: {
		ProjectIDCol: "id", TeamIDCol: "", ResourceIDCol: "id",
	},
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
