package policy

import "errors"

var (
	// ErrUnknownOperation is returned for an operation the catalog does not
	// define.
	ErrUnknownOperation = errors.New("policy: unknown operation")
	// ErrInvalidInstance is returned when an instance does not fit its
	// template: an unknown setting, a value of the wrong type or outside the
	// bounds, or a failed config rule.
	ErrInvalidInstance = errors.New("policy: invalid instance")
	// ErrContextMismatch is returned when the request context does not match
	// the template's context schema. Evaluation fails closed.
	ErrContextMismatch = errors.New("policy: request context does not match the schema")
)
