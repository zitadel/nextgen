package domain

// ErrAuthUnauthorized is returned when a request lacks valid credentials
// at the domain level (e.g. nonce expired, invalid session).
func ErrAuthUnauthorized(err error) Error {
	return newError("auth.unauthorized", "unauthorized", nil, err)
}

// ErrAuthRateLimited is returned when a caller has exceeded the allowed
// number of attempts (cross-cutting, not tied to a single resource).
func ErrAuthRateLimited() Error {
	return newError("auth.rate_limited", "too many failed attempts", nil, nil)
}
