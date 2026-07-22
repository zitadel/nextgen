package domain

// PrefixFlow is the error-code namespace for flow *runtime* (cookie, state
// machine, submit/get step). Flow *definition* CRUD uses PrefixFlowDefinition.
const PrefixFlow ResourcePrefix = "flow"

// Cookie / handle errors (API openState / seal boundaries).

func ErrFlowCookieInvalid() Error {
	return newError(PrefixFlow.ErrorCodePrefix("cookie_invalid"), "flow cookie is missing or invalid", nil, nil)
}

func ErrFlowCookieExpired() Error {
	return newError(PrefixFlow.ErrorCodePrefix("cookie_expired"), "flow cookie has expired", nil, nil)
}

func ErrFlowNotFound() Error {
	return newError(PrefixFlow.ErrorCodePrefix("not_found"), "flow not found", nil, nil)
}

func ErrFlowCompleted() Error {
	return newError(PrefixFlow.ErrorCodePrefix("completed"), "flow has already completed", nil, nil)
}

func ErrFlowInvalidPurpose() Error {
	return newError(PrefixFlow.ErrorCodePrefix("invalid_purpose"), "unknown or unsupported flow purpose", nil, nil)
}

// State-machine errors (formerly plain errors.New sentinels).

func ErrFlowInvalidAction() Error {
	return newError(PrefixFlow.ErrorCodePrefix("invalid_action"), "action is not allowed on the current step", nil, nil)
}

func ErrFlowSessionConflict() Error {
	return newError(PrefixFlow.ErrorCodePrefix("session_conflict"), "flow session version conflict", nil, nil)
}

func ErrFlowUnsupported() Error {
	return newError(PrefixFlow.ErrorCodePrefix("unsupported"), "flow feature is not supported", nil, nil)
}

func ErrFlowIntegrity() Error {
	return newError(PrefixFlow.ErrorCodePrefix("integrity"), "flow state integrity violation", nil, nil)
}
