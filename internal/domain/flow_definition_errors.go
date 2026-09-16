package domain

const PrefixFlowDefinition ResourcePrefix = "flowdef"

// ErrFlowDefinitionNotFound is returned when a direct lookup by name does
// not match any definition for the project.
func ErrFlowDefinitionNotFound() Error {
	return newError(PrefixFlowDefinition.ErrorCodePrefix("not_found"), "flow definition: not found", nil, nil)
}

// ErrFlowDefinitionPurposeMismatch is returned when a direct lookup matches
// a definition that does not serve the requested purpose.
func ErrFlowDefinitionPurposeMismatch() Error {
	return newError(PrefixFlowDefinition.ErrorCodePrefix("purpose_mismatch"), "flow definition: does not serve requested purpose", nil, nil)
}

func ErrFlowDefinitionInvalid(details any, parent error) Error {
	return newError(PrefixFlowDefinition.ErrorCodePrefix("invalid"), "flow definition: invalid", details, parent)
}

func ErrSchemaFetchFailed(details any, parent error) Error {
	return newError(PrefixFlowDefinition.ErrorCodePrefix("schema_fetch_failed"), "flow definition: failed to fetch schema", details, parent)
}

func ErrMissingFlowDefinitionID() Error {
	return newError(PrefixFlowDefinition.ErrorCodePrefix("missing_id"), "flow definition: missing id", nil, nil)
}

func ErrMissingProjectID() Error {
	return newError(PrefixFlowDefinition.ErrorCodePrefix("missing_project_id"), "flow definition: missing project id", nil, nil)
}

func ErrFlowDefinitionPermissionDenied() Error {
	return newError(PrefixFlowDefinition.ErrorCodePrefix("permission_denied"), "flow definition: the flow definition management API requires the project secret", nil, nil)
}
