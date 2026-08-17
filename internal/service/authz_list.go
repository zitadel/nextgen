package service

import (
	"context"
	"errors"

	"github.com/zitadel/nextgen/internal/domain"
)

// AuthzListFilter is the portable authz conjunct injected into resource list
// SQL (EXISTS over the same RSI/assignment/closure/TTU branches as
// ListAuthzObjectIDs). Management compileList requires this on context (#838).
// compileRead and nested lists omit it on purpose (#839).
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

type authzListFilterBypassCtxKey struct{}

// ErrListFilterRequired means a management list ran without AuthzListFilter
// (or an unrestricted/bypass marker) on the context. HTTP maps this to a 500
// with message "authz list filter missing" so it is not triaged as a DB outage.
var ErrListFilterRequired = errors.New("authz list filter missing")

// WithAuthzListFilterBypass marks a list that is not a management HTTP path
// (nested uniqueness/resolve/GetLatest, stmttest, dialect tests). Production
// HTTP list handlers must attach WithAuthzListFilter instead.
func WithAuthzListFilterBypass(ctx context.Context) context.Context {
	return context.WithValue(ctx, authzListFilterBypassCtxKey{}, true)
}

// AuthzListFilterBypassed reports whether WithAuthzListFilterBypass is set.
func AuthzListFilterBypassed(ctx context.Context) bool {
	v, _ := ctx.Value(authzListFilterBypassCtxKey{}).(bool)
	return v
}
