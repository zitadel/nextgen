package service

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
)

// AuthzListFilter is the portable authz conjunct injected into resource list
// SQL (EXISTS over assignments ⋈ closure / membership / RSI), not an IN (ids)
// post-filter. When absent from context, list methods keep project_id scoping only.
type AuthzListFilter struct {
	CatalogID              string
	ProjectID              string
	PrincipalHomeProjectID string
	PrincipalType          domain.AuthzPrincipalType
	PrincipalID            string
	ResourceKind           domain.ResourceKind
	ObjectType             string
	Relation               string
}

type authzListFilterCtxKey struct{}

// WithAuthzListFilter attaches a list authz conjunct for dialect list SQL.
func WithAuthzListFilter(ctx context.Context, filter AuthzListFilter) context.Context {
	return context.WithValue(ctx, authzListFilterCtxKey{}, filter)
}

// AuthzListFilterFromContext returns the list authz filter when present.
func AuthzListFilterFromContext(ctx context.Context) (AuthzListFilter, bool) {
	f, ok := ctx.Value(authzListFilterCtxKey{}).(AuthzListFilter)
	return f, ok
}
