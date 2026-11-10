package api

import (
	"context"
	"net/http"

	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

// stubInvitationError selects which invitation error the contract stubs return.
// It stays on the default so runtime answers 501; the switch keeps every
// invitation code in the OpenAPI error set for gen_openapi_errors until the
// invitation service lands (#2852 / #2853).
var stubInvitationError = stubInvNotImplemented

type stubInvitationErrorKind int

const (
	stubInvNotImplemented stubInvitationErrorKind = iota
	stubInvInvalid
	stubInvNotFound
	stubInvPermissionDenied
	stubInvProjectUnclaimed
	stubInvNotPending
	stubInvSelfAccept
	stubInvPendingLimit
	stubInvPlatformRequired
)

func invitationContractErrors() error {
	switch stubInvitationError {
	case stubInvInvalid:
		return domain.ErrInvitationInvalid()
	case stubInvNotFound:
		return domain.ErrInvitationNotFound()
	case stubInvPermissionDenied:
		return domain.ErrInvitationPermissionDenied()
	case stubInvProjectUnclaimed:
		return domain.ErrInvitationProjectUnclaimed()
	case stubInvNotPending:
		return domain.ErrInvitationNotPending()
	case stubInvSelfAccept:
		return domain.ErrInvitationSelfAccept()
	case stubInvPendingLimit:
		return domain.ErrInvitationPendingLimit()
	case stubInvPlatformRequired:
		return domain.ErrInvitationPlatformRequired()
	default:
		return domain.ErrNotImplemented()
	}
}

func (h *Handler) CreateInvitation(ctx context.Context, req api.CreateInvitationRequest, params api.CreateInvitationParams) (api.CreateInvitationRes, error) {
	// Same project.admin check as createGrant (opDelete).
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), invitationAccess, opDelete); err != nil {
		return nil, err
	}
	if req.IsCreateInvitationTeamMemberRequest() {
		return nil, domain.ErrNotImplemented()
	}
	return nil, invitationContractErrors()
}

func (h *Handler) ListInvitations(ctx context.Context, params api.ListInvitationsParams) (api.ListInvitationsRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), invitationAccess, opDelete); err != nil {
		return nil, err
	}
	return nil, invitationContractErrors()
}

func (h *Handler) GetInvitation(ctx context.Context, params api.GetInvitationParams) (api.GetInvitationRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), invitationAccess, opDelete); err != nil {
		return nil, err
	}
	return nil, invitationContractErrors()
}

func (h *Handler) CancelInvitation(ctx context.Context, params api.CancelInvitationParams) (api.CancelInvitationRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), invitationAccess, opDelete); err != nil {
		return nil, err
	}
	return nil, invitationContractErrors()
}

func (h *Handler) LookupInvitation(ctx context.Context, req *api.InvitationTokenRequest) (api.LookupInvitationRes, error) {
	_ = req
	return nil, invitationContractErrors()
}

func (h *Handler) AcceptInvitation(ctx context.Context, req *api.InvitationTokenRequest) (api.AcceptInvitationRes, error) {
	_ = req
	return nil, invitationContractErrors()
}

func (h *Handler) RejectInvitation(ctx context.Context, req *api.InvitationTokenRequest) (api.RejectInvitationRes, error) {
	_ = req
	return nil, invitationContractErrors()
}

func invitationErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrInvitationInvalid().Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	case domain.ErrInvitationNotFound().Code, domain.ErrInvitationNotPending().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case domain.ErrInvitationPermissionDenied().Code, domain.ErrInvitationSelfAccept().Code:
		return errorResponseWithStatusCode(http.StatusForbidden, err)
	case domain.ErrInvitationProjectUnclaimed().Code,
		domain.ErrInvitationPendingLimit().Code,
		domain.ErrInvitationPlatformRequired().Code:
		return errorResponseWithStatusCode(http.StatusConflict, err)
	default:
		return internalErrorResponse(err)
	}
}
