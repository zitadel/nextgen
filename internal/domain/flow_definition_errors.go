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

func ErrFlowDefinitionAlreadyExists() Error {
	return newError(PrefixFlowDefinition.ErrorCodePrefix("already_exists"), "flow definition: already exists", nil, nil)
}

func ErrFlowDefinitionInvalid(details string) Error {
	return newError(PrefixFlowDefinition.ErrorCodePrefix("invalid"), "flow definition: invalid", details, nil)
}

func ErrUserSchemaFetchFailed(details string) Error {
	return newError(PrefixFlowDefinition.ErrorCodePrefix("user_schema_fetch_failed"), "flow definition: failed to fetch user schema", details, nil)
}
