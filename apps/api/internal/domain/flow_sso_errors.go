package domain

import "errors"

// ErrSSOOwnerOtherSchema reports a unique value held by a user of another
// schema than the flow's. A provider's claim cannot be changed, so the
// callback restarts the flow; a typed value can, so the step shows it taken.
var ErrSSOOwnerOtherSchema = errors.New("sso: unique value is owned by a user of another schema")

// ErrSSOParkedIdentityUnusable reports a parked identity the flow cannot go
// on with: its connection revision is gone, or its user is of another
// schema. The flow restarts, and the cause names why, for the operator's
// line. Log-only: it never reaches a client.
var ErrSSOParkedIdentityUnusable = errors.New("sso: the parked identity cannot be used")
