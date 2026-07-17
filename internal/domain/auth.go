package domain

// ErrAuthUnauthorized is returned when a request lacks valid credentials
// (e.g. missing session cookie, unsatisfied security requirement, expired nonce).
func ErrAuthUnauthorized(err error) Error {
	return newError("auth.unauthorized", "The request lacks valid authentication credentials.", nil, err)
}
