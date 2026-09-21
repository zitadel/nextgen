package policy

import "errors"

var (
	// ErrUnknownOperation is returned for an operation the catalog does not
	// define. A client asking for it has a bug; a project can never be
	// "unconfigured" for a catalogued operation.
	ErrUnknownOperation = errors.New("policy: unknown operation")
	// ErrContextMismatch is returned when the request context does not match
	// the template's context schema. Evaluation fails closed.
	ErrContextMismatch = errors.New("policy: request context does not match the schema")
)
