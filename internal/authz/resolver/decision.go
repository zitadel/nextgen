// Package resolver evaluates single-resource permission checks and list
// authorization against relational authz storage (ADR 032–033 / issue #423).
package resolver

import "fmt"

// Decision is the library-level outcome of a permission check (not an HTTP code).
type Decision uint8

const (
	// DecisionUnspecified is the zero value and must not be returned by Check.
	DecisionUnspecified Decision = iota
	// DecisionAllow means the principal holds the required permission.
	DecisionAllow
	// DecisionNotFound means the principal has no foothold in the project scope
	// (maps to HTTP 404 later).
	DecisionNotFound
	// DecisionForbidden means the principal has a project foothold but lacks the
	// required permission (maps to HTTP 403 later).
	DecisionForbidden
)

func (d Decision) String() string {
	switch d {
	case DecisionAllow:
		return "allow"
	case DecisionNotFound:
		return "not_found"
	case DecisionForbidden:
		return "forbidden"
	case DecisionUnspecified:
		return "unspecified"
	default:
		return fmt.Sprintf("Decision(%d)", uint8(d))
	}
}
