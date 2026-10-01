package domain

import "context"

// FlowSSOIdentityService reads and settles the external identity an SSO
// callback parked on the flow's auth attempt. The domain cannot parse a
// connection revision (internal/idp imports domain), so the implementation
// does the parsing and hands back a [FlowSSOParkedIdentity].
type FlowSSOIdentityService interface {
	// LoadParked returns nil, nil when the attempt has no parked result. It
	// returns ErrFlowRestartRequired when the provider's subject is linked to
	// a user under another schema than the flow's.
	LoadParked(ctx context.Context, in FlowSSOLoadInput) (*FlowSSOParkedIdentity, error)
	// BindLinked records the linked user and an sso factor on the attempt and
	// deletes the parked row, in one transaction. It returns
	// ErrFlowRestartRequired when the attempt already carries another user.
	BindLinked(ctx context.Context, in FlowSSOBindInput) error
	// DeleteParked removes the parked row. No row is not an error.
	DeleteParked(ctx context.Context, projectID, attemptID string) error
	// CreateLinked creates the user, its identity link and the attempt
	// factors in one transaction, and returns the new user's id.
	CreateLinked(ctx context.Context, in FlowSSOCreateInput) (userID string, err error)
}

type FlowSSOLoadInput struct {
	ProjectID, AttemptID, UserSchemaURL string
	// ResolvedCheckID is [FlowState.SSOResolvedCheckID]. A parked row with
	// this id was already resolved, so LoadParked returns nil, nil for it.
	ResolvedCheckID string
}

// FlowSSOParkedIdentity is a parked callback result, resolved against its
// pinned connection revision and the identity links.
type FlowSSOParkedIdentity struct {
	// CheckID is the parked row's id, the replay key for
	// [FlowState.SSOResolvedCheckID].
	CheckID string
	// ConnectionID is the connection's stable id, never the revision id.
	ConnectionID string
	Subject      string
	// Claims are keyed by user-schema property.
	Claims map[string]any
	// Verified is keyed by user-schema property.
	Verified         map[string]bool
	CreationDisabled bool
	// Link is nil when the subject has no identity link on the connection.
	Link *FlowSSOLinkedUser
}

type FlowSSOLinkedUser struct{ LinkID, UserID string }

type FlowSSOBindInput struct{ ProjectID, AttemptID, UserID, ConnectionID, LinkID string }

type FlowSSOCreateInput struct {
	ProjectID, AttemptID, UserSchemaURL, ConnectionID, Subject string
	Attributes                                                 map[string]any
}
