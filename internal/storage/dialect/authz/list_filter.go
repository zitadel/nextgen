package authz

import "errors"

// ErrListFilterRequired is returned when compileList is asked to build a
// management list (non-empty table + resource id column) without an
// AuthzListFilter on the context.
var ErrListFilterRequired = errors.New("authz: management list requires AuthzListFilter on context")
