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

// Path names what allowed a Check (ADR 053 §8). The API stamps it on the
// request's audit events when it is not an ordinary grant.
type Path uint8

const (
	// PathNone: the Check did not allow.
	PathNone Path = iota
	// PathGrant: an assignment on the protected project allowed it.
	PathGrant
	// PathPlatformOperator: the deployment-wide operator relation allowed it
	// (ADR 075 §3).
	PathPlatformOperator
)

func (p Path) String() string {
	switch p {
	case PathNone:
		return "none"
	case PathGrant:
		return "grant"
	case PathPlatformOperator:
		return "platform_operator"
	default:
		return fmt.Sprintf("Path(%d)", uint8(p))
	}
}
