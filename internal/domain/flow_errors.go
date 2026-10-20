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

// ErrFlowRestartRequired ends a flow that cannot continue with the identity it
// resolved: the attempt is bound to another user, or the provider's user lives
// under another schema. The message is fixed and the error never carries the
// resolved values; callers log them instead.
func ErrFlowRestartRequired() Error {
	return newError(PrefixFlow.ErrorCodePrefix("restart_required"), "the flow must be restarted", nil, nil)
}

func ErrFlowIntegrity() Error {
	return newError(PrefixFlow.ErrorCodePrefix("integrity"), "flow state integrity violation", nil, nil)
}

// ErrFlowSSOUnavailable reports a provider the engine could not start a
// sign-in with: discovery failed or the connection document breaks a
// protocol rule. The user stays on the step and may pick another method;
// cause is log-only.
func ErrFlowSSOUnavailable(cause error) Error {
	return newError(PrefixFlow.ErrorCodePrefix("sso_unavailable"), "identity provider is unavailable", nil, cause)
}
