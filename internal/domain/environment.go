package domain

// PrefixEnvironment only namespaces the error codes below: no resource is
// minted under it. The deployment service and its access check still answer
// them.
const PrefixEnvironment ResourcePrefix = "env"

func ErrEnvironmentNotFound() Error {
	return newError(PrefixEnvironment.ErrorCodePrefix("not_found"), "environment not found", nil, nil)
}

func ErrEnvironmentProjectNotFound() Error {
	return newError(PrefixEnvironment.ErrorCodePrefix("project_not_found"), "project not found", nil, nil)
}
