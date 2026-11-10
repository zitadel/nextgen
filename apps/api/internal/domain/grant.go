package domain

// PrefixGrant is the public error-code prefix for the grants HTTP API
// (grant.not_found). Assignment IDs stay PrefixAuthzAssignment (asgn_<opaque>).
const PrefixGrant ResourcePrefix = "grant"

func ErrGrantInvalid() Error {
	return newError(PrefixGrant.ErrorCodePrefix("invalid"), "the grant request is invalid", nil, nil)
}

func ErrGrantNotFound() Error {
	return newError(PrefixGrant.ErrorCodePrefix("not_found"), "grant not found", nil, nil)
}

func ErrGrantAlreadyExists() Error {
	return newError(PrefixGrant.ErrorCodePrefix("already_exists"), "an unrevoked grant with this principal and relation already exists on the project", nil, nil)
}

func ErrGrantPrincipalNotFound() Error {
	return newError(PrefixGrant.ErrorCodePrefix("principal_not_found"), "the principal could not be resolved", nil, nil)
}

func ErrGrantPermissionDenied() Error {
	return newError(PrefixGrant.ErrorCodePrefix("permission_denied"), "insufficient permissions to manage grants", nil, nil)
}

// ErrGrantProjectUnclaimed refuses a grant to a principal from another project
// while the granting project has no owning team (ADR 054 §4 amendment).
func ErrGrantProjectUnclaimed() Error {
	return newError(PrefixGrant.ErrorCodePrefix("project_unclaimed"), "claim the project before granting access to it", nil, nil)
}
