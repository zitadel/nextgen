package service

import (
	"context"
	"errors"

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
// An unrestricted wrap wins over an inherited filter so nested uniqueness /
// resolve / GetLatest queries are not EXISTS-narrowed to the outer kind.
func AuthzListFilterFromContext(ctx context.Context) (AuthzListFilter, bool) {
	if AuthzListUnrestricted(ctx) {
		return AuthzListFilter{}, false
	}
	f, ok := ctx.Value(authzListFilterCtxKey{}).(AuthzListFilter)
	return f, ok
}

type authzListUnrestrictedCtxKey struct{}
type authzListSkipOnceCtxKey struct{}

type authzListSkipOnce struct {
	consumed bool
}

// ErrListFilterRequired means a management list ran without AuthzListFilter
// (or an unrestricted / one-shot skip marker) on the context. HTTP maps this
// to a 500 with message "authz list filter missing" so it is not triaged as a
// DB outage.
var ErrListFilterRequired = errors.New("authz list filter missing")

// WithAuthzListUnrestricted marks a nested non-HTTP list (create uniqueness,
// login Resolve, branding GetLatest, stmttest). It skips the #838 tripwire
// and ignores an inherited AuthzListFilter so a nested query cannot see zero
// rows from the outer kind's EXISTS.
func WithAuthzListUnrestricted(ctx context.Context) context.Context {
	return context.WithValue(ctx, authzListUnrestrictedCtxKey{}, true)
}

// AuthzListUnrestricted reports whether WithAuthzListUnrestricted is set.
func AuthzListUnrestricted(ctx context.Context) bool {
	v, _ := ctx.Value(authzListUnrestrictedCtxKey{}).(bool)
	return v
}

// WithAuthzListSkipOnce is the project-wide Allow skip: the next compileList
// or ListUsers consumes it and omits EXISTS. A later management list on the
// same request without a filter still fails closed (#838). Do not use this
// for nested uniqueness / resolve — those must use WithAuthzListUnrestricted.
func WithAuthzListSkipOnce(ctx context.Context) context.Context {
	return context.WithValue(ctx, authzListSkipOnceCtxKey{}, &authzListSkipOnce{})
}

// AuthzListSkipOncePending reports whether a one-shot Allow skip is still
// available (not yet consumed).
func AuthzListSkipOncePending(ctx context.Context) bool {
	v, _ := ctx.Value(authzListSkipOnceCtxKey{}).(*authzListSkipOnce)
	return v != nil && !v.consumed
}

// ConsumeAuthzListSkipOnce returns true once for a WithAuthzListSkipOnce
// context, then false. compileList / ListUsers call this from
// RequireManagementListFilter.
func ConsumeAuthzListSkipOnce(ctx context.Context) bool {
	v, _ := ctx.Value(authzListSkipOnceCtxKey{}).(*authzListSkipOnce)
	if v == nil || v.consumed {
		return false
	}
	v.consumed = true
	return true
}
