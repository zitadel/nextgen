package domain

// ErrAuthUnauthorized is returned when a request lacks valid credentials
// (e.g. missing session cookie, unsatisfied security requirement, expired nonce).
func ErrAuthUnauthorized(err error) Error {
	return newError("auth.unauthorized", "The request lacks valid authentication credentials.", nil, err)
}

// ErrAuthCSRFInvalid is returned when a state-changing request authenticated
// by the Console session cookie fails the cross-site request forgery checks
// (ADR 053 §5): it came from another origin, or it lacks the session-bound
// X-Zitadel-CSRF token.
func ErrAuthCSRFInvalid() Error {
	return newError("auth.csrf_invalid", "The request failed cross-site request forgery validation.", nil, nil)
}
