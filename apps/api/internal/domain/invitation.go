package domain

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
