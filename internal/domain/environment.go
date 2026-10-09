package domain

// PrefixEnvironment only namespaces the error codes below: no resource is
// minted under it. The variables operations still accept environment_name and
// answer env.not_found for it, and the deployment access check answers
// env.project_not_found.
const PrefixEnvironment ResourcePrefix = "env"

func ErrEnvironmentNotFound() Error {
	return newError(PrefixEnvironment.ErrorCodePrefix("not_found"), "environment not found", nil, nil)
}

func ErrEnvironmentProjectNotFound() Error {
	return newError(PrefixEnvironment.ErrorCodePrefix("project_not_found"), "project not found", nil, nil)
}
