package service

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
)

// AuthzListFilter is the portable authz conjunct injected into resource list
// SQL. Management compileList requires this on context; compileRead and nested
// lists omit it on purpose.
type AuthzListFilter = domain.AuthzListObjectsParams

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

type authzListUnrestrictedCtxKey struct{}

// WithAuthzListUnrestricted marks a list that must not fail closed and must
// not write EXISTS: project-wide Allow, or a storage-layer test that is not a
// management HTTP path.
func WithAuthzListUnrestricted(ctx context.Context) context.Context {
	return context.WithValue(ctx, authzListUnrestrictedCtxKey{}, true)
}

// AuthzListUnrestricted reports whether WithAuthzListUnrestricted is set.
func AuthzListUnrestricted(ctx context.Context) bool {
	v, _ := ctx.Value(authzListUnrestrictedCtxKey{}).(bool)
	return v
}
