package domain

import "time"

// PrefixInvitation is the dialect-minted ID prefix for invitations (inv_<opaque>)
// and the public error-code prefix (inv.not_found).
const PrefixInvitation ResourcePrefix = "inv"

func ErrInvitationInvalid() Error {
	return newError(PrefixInvitation.ErrorCodePrefix("invalid"), "the invitation request is invalid", nil, nil)
}

func ErrInvitationNotFound() Error {
	return newError(PrefixInvitation.ErrorCodePrefix("not_found"), "invitation not found", nil, nil)
}

func ErrInvitationPermissionDenied() Error {
	return newError(PrefixInvitation.ErrorCodePrefix("permission_denied"), "insufficient permissions to manage invitations", nil, nil)
}

// ErrInvitationProjectUnclaimed refuses invitations on a project that has no
// owning team yet (ADR 086 §10 / ADR 054 §4 amendment).
func ErrInvitationProjectUnclaimed() Error {
	return newError(PrefixInvitation.ErrorCodePrefix("project_unclaimed"), "claim the project before inviting into it", nil, nil)
}

// ErrInvitationNotPending is the internal finished-state signal. The HTTP
// layer maps it to ErrInvitationNotFound so cancel and token endpoints keep an
// opaque 404 (ADR 086).
func ErrInvitationNotPending() Error {
	return newError(PrefixInvitation.ErrorCodePrefix("not_pending"), "the invitation is no longer pending", nil, nil)
}

func ErrInvitationSelfAccept() Error {
	return newError(PrefixInvitation.ErrorCodePrefix("self_accept"), "the inviter cannot accept their own invitation", nil, nil)
}

func ErrInvitationPendingLimit() Error {
	return newError(PrefixInvitation.ErrorCodePrefix("pending_limit"), "the project has reached its pending invitation limit", nil, nil)
}

func ErrInvitationPlatformRequired() Error {
	return newError(PrefixInvitation.ErrorCodePrefix("platform_required"), "invitations require a platform project", nil, nil)
}

// InvitationType names what accepting an invitation grants. Each type keeps
// its own fields in the object named after it.
type InvitationType string

const (
	InvitationTypeProjectMember InvitationType = "project_member"
)

// InvitationStatus is an invitation's lifecycle status. Storage keeps pending,
// accepted and rejected; expired is a pending invitation past its expiry.
type InvitationStatus string

const (
	InvitationStatusPending  InvitationStatus = "pending"
	InvitationStatusAccepted InvitationStatus = "accepted"
	InvitationStatusRejected InvitationStatus = "rejected"
	InvitationStatusExpired  InvitationStatus = "expired"
)

// InvitationProjectMember is the project_member type's object.
type InvitationProjectMember struct {
	// Relation is the project role the accepter receives: viewer, editor or
	// admin, as in POST /grants.
	Relation string `json:"relation"`
}

// Invitation is a link that grants its type's target to whoever redeems it
// (ADR 086). Only the hash of the link's token is stored.
type Invitation struct {
	ProjectID     string
	ID            string
	Type          InvitationType
	ProjectMember *InvitationProjectMember
	// EncryptedMetadata is the metadata encrypted with the project's key; nil
	// once accepted or declined.
	EncryptedMetadata *string
	// Status is the stored status, never expired; StatusAt derives that.
	Status        InvitationStatus
	CreatedBy     *string
	CreatedByType *EventActorType
	CreatedAt     time.Time
	ExpiresAt     time.Time
	JourneyID     string
	AcceptedBy    *string
	AcceptedAt    *time.Time
	// TokenHash is HashSecret of the link's token.
	TokenHash string
}

// StatusAt is the invitation's status at now: pending past ExpiresAt is
// expired.
func (i *Invitation) StatusAt(now time.Time) InvitationStatus {
	if i.Status == InvitationStatusPending && !now.Before(i.ExpiresAt) {
		return InvitationStatusExpired
	}
	return i.Status
}

// InvitationField enumerates the fields of Invitation which can be used for
// filtering and ordering in list operations.
type InvitationField uint8

const (
	InvitationFieldUnspecified InvitationField = iota
	InvitationFieldProjectID
	InvitationFieldID
	InvitationFieldType
	InvitationFieldStatus
	InvitationFieldCreatedAt
	InvitationFieldExpiresAt
)
