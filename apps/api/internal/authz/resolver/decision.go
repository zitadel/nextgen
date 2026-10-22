// Package resolver evaluates single-resource permission checks and list
// authorization against relational authz storage (ADR 032–033 / issue #423).
package resolver

import "fmt"

// Decision is the library-level outcome of a permission check (not an HTTP code).
type Decision uint8

const (
	DecisionUnspecified Decision = iota
	DecisionAllow
	DecisionNotFound
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
