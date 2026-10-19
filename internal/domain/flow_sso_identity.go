package domain

import (
	"context"
	"errors"
)

// ErrSSOOwnerOtherSchema reports a unique value held by a user of another
// schema than the flow's. A provider's claim cannot be changed, so the
// callback restarts the flow; a typed value can, so the step shows it taken.
var ErrSSOOwnerOtherSchema = errors.New("sso: unique value is owned by a user of another schema")

// FlowSSOIdentityService reads and settles the external identity an SSO
// callback parked on the flow's auth attempt. The domain cannot parse a
// connection revision (internal/idp imports domain), so the implementation
// does the parsing and hands back a [FlowSSOParkedIdentity].
type FlowSSOIdentityService interface {
	// LoadParked returns nil, nil when the attempt has no parked result, unless
	// an earlier bind left it waiting for its handoff (see BoundUserID). It
	// returns ErrFlowRestartRequired when the attempt is expired or handed
	// off, and when the provider's subject is linked to a user under another
	// schema than the flow's.
	LoadParked(ctx context.Context, in FlowSSOLoadInput) (*FlowSSOParkedIdentity, error)
	// LoadCollected reads the parked row LoadParked skips: the one with
	// in.ResolvedCheckID, left parked for a collection step. It returns
	// CheckID, ConnectionID, Subject, Claims and Verified, and no link. It
	// returns nil, nil when that row is gone, was replaced, holds no result or
	// holds a collision marker, and ErrFlowRestartRequired when it holds an
	// error result, or its connection revision no longer exists or disables
	// creation.
	LoadCollected(ctx context.Context, in FlowSSOLoadInput) (*FlowSSOParkedIdentity, error)
	// BindLinked records the linked user and an sso factor on the attempt and
	// deletes the parked row with in.CheckID, in one transaction. It returns
	// ErrFlowRestartRequired when the attempt already carries another user or
	// is expired or handed off, and ErrSSOStateInvalid, before writing
	// anything, when that row is gone.
	BindLinked(ctx context.Context, in FlowSSOBindInput) error
	// BindCollision binds the user FindUniqueOwner found, by id, in one
	// transaction: a user factor only, no link and no sso factor. The parked
	// row keeps only a marker of that user, so a retry after a lost cookie
	// raises the outcome again. It returns ErrSSOStateInvalid when the row is
	// gone and ErrFlowRestartRequired when the attempt carries another user or
	// is expired or handed off.
	BindCollision(ctx context.Context, in FlowSSOBindInput) error
	// FindUniqueOwner returns the user whose value at the attribute path
	// would collide with a new user with no team, or "" with a nil error
	// when nobody's does. It only reads: unlike an identifier submission it
	// records nothing on the attempt. It returns ErrSSOOwnerOtherSchema when
	// the owner is a user of another schema than the flow's.
	FindUniqueOwner(ctx context.Context, projectID, userSchemaURL, attribute string, value any) (userID string, err error)
	// CreateLinked creates the user, its identity link and the attempt
	// factors in one transaction, and returns the new user's id.
	CreateLinked(ctx context.Context, in FlowSSOCreateInput) (userID string, err error)
}

type FlowSSOLoadInput struct {
	ProjectID, AttemptID, UserSchemaURL string
	// ResolvedCheckID is [FlowState.SSOResolvedCheckID]. A parked row with
	// this id was already resolved, so LoadParked returns nil, nil for it,
	// unless the row holds a collision marker.
	ResolvedCheckID string
}

// FlowSSOParkedIdentity is a parked callback result, resolved against its
// pinned connection revision and the identity links.
type FlowSSOParkedIdentity struct {
	// CheckID is the parked row's id, the replay key for
	// [FlowState.SSOResolvedCheckID].
	CheckID string
	// ErrorKey is set when the ceremony failed ([SSOCallbackResult.ErrorKey]):
	// the step renders it as its error. Only CheckID and AttemptUserID are set
	// besides it; the row carries no identity to resolve.
	ErrorKey string
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
	// BoundUserID is set when a previous request already bound the attempt
	// through SSO; the engine re-raises the success outcome so a lost handoff
	// can be retried. Every other field is then empty.
	BoundUserID string
	// CollisionUserID is set when the parked row holds the collision marker
	// ([SSOCallbackResult.CollisionUserID]) a collision bind wrote with the user
	// factor, whatever the cookie recorded. The cookie that recorded the bind
	// may have been lost, so the engine catches the state up. Only CheckID
	// and AttemptUserID are set besides it.
	CollisionUserID string
	// AttemptUserID is the user of the user factor the attempt carries when it
	// is read, whatever wrote it: a signed-in session copies its user in, a
	// typed identifier or an earlier bind binds one. Empty when none.
	AttemptUserID string
}

type FlowSSOLinkedUser struct{ LinkID, UserID string }

// FlowSSOBindInput settles the parked row CheckID, the one LoadParked or
// LoadCollected read.
type FlowSSOBindInput struct{ ProjectID, AttemptID, CheckID, UserID, ConnectionID, LinkID string }

// FlowSSOCreateInput creates a user for the parked row CheckID, the one
// LoadParked or LoadCollected read.
type FlowSSOCreateInput struct {
	ProjectID, AttemptID, CheckID, UserSchemaURL, ConnectionID, Subject string
	Attributes                                                          map[string]any
	// Password is empty unless the definition collects one on the way.
	Password string
}
