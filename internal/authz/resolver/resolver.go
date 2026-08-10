package resolver

import (
	"context"
	"fmt"
	"sync"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// Stmts is the storage surface the resolver needs.
type Stmts interface {
	service.AuthzResolverStatements
}

// Request is the public Check input. CatalogID is never accepted from callers;
// the resolver looks up the active system catalog itself.
type Request struct {
	PrincipalType   domain.AuthzPrincipalType
	PrincipalID     string
	CredentialClass domain.AuthzPrincipalType // for allowlist; often equals PrincipalType
	ProjectID       string
	ObjectType      string
	Relation        string
}

// ListRequest is the public ListObjects input.
type ListRequest struct {
	PrincipalType   domain.AuthzPrincipalType
	PrincipalID     string
	CredentialClass domain.AuthzPrincipalType
	ProjectID       string
	ResourceKind    domain.ResourceKind
	ObjectType      string
	Relation        string
}

// ResourceColumns documents which resource-table columns carry scope ids for
// future predicate injection. ListObjects today uses resource_scope_index via
// statements and does not require these values at runtime.
type ResourceColumns struct {
	ProjectIDCol  string
	TeamIDCol     string
	ResourceIDCol string
}

// Resolver evaluates checks with optional request-scoped memoization.
type Resolver struct {
	mu           sync.Mutex
	catalogID    string
	catalogReady bool
	memo         map[string]Decision
}

// New returns a request-scoped resolver (create one per request / test).
func New() *Resolver {
	return &Resolver{memo: make(map[string]Decision)}
}

// Check returns Allow / NotFound / Forbidden for one permission check.
func (r *Resolver) Check(ctx context.Context, stmts Stmts, req Request) (Decision, error) {
	if err := validateCheckRequest(req); err != nil {
		return DecisionUnspecified, err
	}

	cred := req.CredentialClass
	if cred == "" {
		cred = req.PrincipalType
	}
	if cred == domain.AuthzPrincipalTypeSKTeam {
		if !skTeamPermissionAllowed(PermissionName(req.ObjectType, req.Relation)) {
			return DecisionNotFound, nil
		}
	}

	key := checkMemoKey(req)
	if d, ok := r.memoGet(key); ok {
		return d, nil
	}

	catalogID, err := r.activeCatalogID(ctx, stmts)
	if err != nil {
		return DecisionUnspecified, err
	}

	allowed, err := stmts.CheckAuthz(ctx, domain.AuthzCheckParams{
		CatalogID:              catalogID,
		ProjectID:              req.ProjectID,
		PrincipalHomeProjectID: req.ProjectID, // MVP: local teams only (#333 deferred)
		PrincipalType:          req.PrincipalType,
		PrincipalID:            req.PrincipalID,
		ObjectType:             req.ObjectType,
		Relation:               req.Relation,
	})
	if err != nil {
		return DecisionUnspecified, err
	}
	if allowed {
		r.memoSet(key, DecisionAllow)
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
	r.memoSet(key, d)
	return d, nil
}

// ListObjects returns resource_scope_index ids of ResourceKind the principal may see.
func (r *Resolver) ListObjects(ctx context.Context, stmts Stmts, req ListRequest) ([]string, error) {
	if err := validateListRequest(req); err != nil {
		return nil, err
	}
	cred := req.CredentialClass
	if cred == "" {
		cred = req.PrincipalType
	}
	if cred == domain.AuthzPrincipalTypeSKTeam {
		if !skTeamPermissionAllowed(PermissionName(req.ObjectType, req.Relation)) {
			return []string{}, nil
		}
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

func (r *Resolver) activeCatalogID(ctx context.Context, stmts Stmts) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.catalogReady {
		return r.catalogID, nil
	}
	id, err := stmts.ActiveSystemCatalogID(ctx)
	if err != nil {
		return "", err
	}
	r.catalogID = id
	r.catalogReady = true
	return id, nil
}

func (r *Resolver) memoGet(key string) (Decision, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	d, ok := r.memo[key]
	return d, ok
}

func (r *Resolver) memoSet(key string, d Decision) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.memo[key] = d
}

func checkMemoKey(req Request) string {
	cred := req.CredentialClass
	if cred == "" {
		cred = req.PrincipalType
	}
	return fmt.Sprintf("%s|%s|%s|%s|%s|%s",
		req.PrincipalType, req.PrincipalID, cred, req.ProjectID, req.ObjectType, req.Relation)
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
