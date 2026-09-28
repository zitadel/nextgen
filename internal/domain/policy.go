package domain

import (
	"time"

	"github.com/zitadel/nextgen/internal/policy"
)

// PrefixPolicy namespaces policy revision ids ("pol_01KWH…"), the id a release
// pins (ADR 035 reserved it for the policy kind).
const PrefixPolicy ResourcePrefix = "pol"

func ErrPolicyNotFound() Error {
	return newError(PrefixPolicy.ErrorCodePrefix("not_found"), "policy: not found", nil, nil)
}

func ErrPolicyInvalid(details any, parent error) Error {
	return newError(PrefixPolicy.ErrorCodePrefix("invalid"), "policy: invalid", details, parent)
}

func ErrPolicyPermissionDenied() Error {
	return newError(PrefixPolicy.ErrorCodePrefix("permission_denied"), "policy: requires an operator-grade token bound to the project (project.write or a policy.* scope)", nil, nil)
}

// Policy is one immutable revision of a policy instance (ADR 066): the
// developer-authored config for one catalogued operation, applying to the
// whole project. Revisions are never updated or deleted; every edit publishes
// a new revision and evaluation resolves the newest one per operation.
type Policy struct {
	ProjectID string
	ID        string
	Operation string
	Config    map[string]any
	CreatedAt time.Time
}

// Instance returns the evaluator's view of the revision.
func (p *Policy) Instance() *policy.Instance {
	return &policy.Instance{
		Kind:      policy.KindPolicy,
		Operation: p.Operation,
		Config:    p.Config,
	}
}

// PolicyField enumerates the fields of Policy which can be used for filtering
// and ordering in list operations.
type PolicyField uint8

const (
	PolicyFieldUnspecified PolicyField = iota
	PolicyFieldProjectID
	PolicyFieldID
	PolicyFieldOperation
	PolicyFieldCreatedAt
)

// NewPolicy builds a revision from an instance document. Config validation
// against the operation's template is the service's job, since it needs the
// compiled catalog.
func NewPolicy(projectID string, inst *policy.Instance) (*Policy, error) {
	if projectID == "" {
		return nil, ErrPolicyInvalid("project id is required", nil)
	}
	if inst == nil || inst.Operation == "" {
		return nil, ErrPolicyInvalid("operation is required", nil)
	}
	if inst.Kind != "" && inst.Kind != policy.KindPolicy {
		return nil, ErrPolicyInvalid("kind must be \"policy\"", nil)
	}
	cfg := inst.Config
	if cfg == nil {
		cfg = map[string]any{}
	}
	return &Policy{
		ProjectID: projectID,
		Operation: inst.Operation,
		Config:    cfg,
		CreatedAt: time.Now().UTC(),
	}, nil
}

// ReleasePolicyHandle is the handle a release pointer carries for a policy
// revision: the operation, so two revisions of the same instance collide
// while instances for different operations do not.
func ReleasePolicyHandle(p *Policy) string {
	return p.Operation
}
