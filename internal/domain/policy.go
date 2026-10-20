package domain

import "time"

// PrefixPolicy namespaces policy ids ("pol_01KX..."), the id a policy keeps
// across its revisions (ADR 063, ADR 066).
const PrefixPolicy ResourcePrefix = "pol"

// PrefixPolicyRevision namespaces policy revision ids ("polrev_01KX..."), the
// id of one immutable revision.
const PrefixPolicyRevision ResourcePrefix = "polrev"

// Policy is one revision of a project's policy instance for one operation
// (ADR 066). ID is shared by every revision of the operation's policy in the
// project; RevisionID names this revision. Config is the instance's settings
// as published, a JSON object the operation's template validates.
type Policy struct {
	ProjectID  string
	ID         string
	RevisionID string
	Operation  string
	Config     []byte
	// CreatedAt is when the policy was first published; UpdatedAt when this
	// revision was.
	CreatedAt time.Time
	UpdatedAt time.Time
}

// PolicyField enumerates the fields of Policy that reads filter and order on.
type PolicyField uint8

const (
	PolicyFieldUnspecified PolicyField = iota
	PolicyFieldProjectID
	PolicyFieldID
	PolicyFieldOperation
	PolicyFieldRevisionID
	PolicyFieldCreatedAt
	PolicyFieldUpdatedAt
)
