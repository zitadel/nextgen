package domain

// ErrRequestInvalid is returned when an incoming HTTP request fails structural
// validation (missing required fields, wrong types, failed regex, etc.)
// before it reaches domain logic.
func ErrRequestInvalid() Error {
	return newError("req.invalid", "invalid request", nil, nil)
}
