package authz

import (
	"context"

	"github.com/zitadel/nextgen/internal/service"
)

// ErrListFilterRequired is returned when a management list runs without an
// AuthzListFilter (or unrestricted / one-shot skip marker) on the context.
var ErrListFilterRequired = service.ErrListFilterRequired

// RequireManagementListFilter is the #838 tripwire: compileList and hand-built
// lists (ListUsers) must not SELECT the world if the HTTP filter was forgotten.
// Unrestricted nested lists are checked first so they do not consume Allow's
// one-shot skip.
func RequireManagementListFilter(ctx context.Context) error {
	if service.AuthzListUnrestricted(ctx) {
		return nil
	}
	if service.ConsumeAuthzListSkipOnce(ctx) {
		return nil
	}
	if _, ok := service.AuthzListFilterFromContext(ctx); ok {
		return nil
	}
	return ErrListFilterRequired
}
