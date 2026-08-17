package authz

import (
	"context"

	"github.com/zitadel/nextgen/internal/service"
)

// ErrListFilterRequired is returned when a management list runs without an
// AuthzListFilter (or unrestricted/bypass marker) on the context.
var ErrListFilterRequired = service.ErrListFilterRequired

// RequireManagementListFilter is the #838 tripwire: compileList and hand-built
// lists (ListUsers) must not SELECT the world if the HTTP filter was forgotten.
func RequireManagementListFilter(ctx context.Context) error {
	if _, ok := service.AuthzListFilterFromContext(ctx); ok {
		return nil
	}
	if service.AuthzListFilterBypassed(ctx) {
		return nil
	}
	return ErrListFilterRequired
}
