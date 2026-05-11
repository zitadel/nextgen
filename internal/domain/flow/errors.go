package flow

import "errors"

// TODO(ADR-010): convert these sentinels to CodedError once that type
// lands in internal/domain. The api layer needs a public code +
// description to map domain errors to HTTP/SCIM/SAML statuses.

// Selector errors returned by use cases that resolve a flow definition
// for an incoming request.
var (
	// ErrFlowNotFound is returned when a direct lookup by name does not
	// match any definition for the project.
	ErrFlowNotFound = errors.New("flow: definition not found")

	// ErrPurposeMismatch is returned when a direct lookup matches a
	// definition that does not serve the requested purpose.
	ErrPurposeMismatch = errors.New("flow: definition does not serve requested purpose")
)
