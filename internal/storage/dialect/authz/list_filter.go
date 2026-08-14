package authz

import (
	"context"
	"errors"

	"github.com/zitadel/nextgen/internal/service"
)

// ErrListFilterRequired is returned when compileList is asked to build a
// management list without an AuthzListFilter on the context.
var ErrListFilterRequired = errors.New("authz: management list requires AuthzListFilter on context")

// RequireManagementListFilter fails closed when a management list has neither
// an AuthzListFilter nor an unrestricted marker (project-wide Allow or a
// storage-layer test that is not a management HTTP path).
func RequireManagementListFilter(ctx context.Context) error {
	if _, ok := service.AuthzListFilterFromContext(ctx); ok {
		return nil
	}
	if service.AuthzListUnrestricted(ctx) {
		return nil
	}
	return ErrListFilterRequired
}
