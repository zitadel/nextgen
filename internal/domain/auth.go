package domain

// ErrAuthUnauthorized is returned when a request lacks valid credentials
// at the domain level (e.g. nonce expired, invalid session).
func ErrAuthUnauthorized(err error) Error {
	return newError("auth.unauthorized", "The request lacks valid credentials at the domain level (e.g. nonce expired, invalid session).", nil, err)
}
