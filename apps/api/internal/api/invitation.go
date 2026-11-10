package api

import (
	"context"
	"net/http"

	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

// invitationStubPhase stays 0 so contract stubs answer not_implemented at
// runtime. Non-zero cases exist only so gen_openapi_errors records the codes
// each operation can return once #2852 / #2853 land. Keep each switch limited
// to that operation's reachable set — do not share one fan-out across ops.
var invitationStubPhase int

func (h *Handler) CreateInvitation(ctx context.Context, req api.CreateInvitationRequest, params api.CreateInvitationParams) (api.CreateInvitationRes, error) {
	// Same project.admin check as createGrant (opDelete).
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), invitationAccess, opDelete); err != nil {
		return nil, err
	}
	if req.IsCreateInvitationTeamMemberRequest() {
		return nil, domain.ErrNotImplemented()
	}
	switch invitationStubPhase {
	case 1:
		return nil, domain.ErrInvitationInvalid()
	case 2:
		return nil, domain.ErrInvitationProjectUnclaimed()
	case 3:
		return nil, domain.ErrInvitationPendingLimit()
	case 4:
		return nil, domain.ErrInvitationPlatformRequired()
	case 5:
		return nil, domain.ErrInvitationNotFound() // replace target miss
	default:
		return nil, domain.ErrNotImplemented()
	}
}

func (h *Handler) ListInvitations(ctx context.Context, params api.ListInvitationsParams) (api.ListInvitationsRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), invitationAccess, opDelete); err != nil {
		return nil, err
	}
	// Authz already contributes inv.not_found / inv.permission_denied.
	return nil, domain.ErrNotImplemented()
}

func (h *Handler) GetInvitation(ctx context.Context, params api.GetInvitationParams) (api.GetInvitationRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), invitationAccess, opDelete); err != nil {
		return nil, err
	}
	switch invitationStubPhase {
	case 1:
		return nil, domain.ErrInvitationNotFound()
	default:
		return nil, domain.ErrNotImplemented()
	}
}

func (h *Handler) CancelInvitation(ctx context.Context, params api.CancelInvitationParams) (api.CancelInvitationRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), invitationAccess, opDelete); err != nil {
		return nil, err
	}
	switch invitationStubPhase {
	case 1:
		return nil, domain.ErrInvitationNotFound()
	case 2:
		return nil, domain.ErrInvitationNotPending()
	default:
		return nil, domain.ErrNotImplemented()
	}
}

func (h *Handler) LookupInvitation(ctx context.Context, req *api.InvitationTokenRequest) (api.LookupInvitationRes, error) {
	_ = req
	switch invitationStubPhase {
	case 1:
		return nil, domain.ErrInvitationNotFound()
	default:
		return nil, domain.ErrNotImplemented()
	}
}

func (h *Handler) AcceptInvitation(ctx context.Context, req *api.InvitationTokenRequest) (api.AcceptInvitationRes, error) {
	_ = req
	switch invitationStubPhase {
	case 1:
		return nil, domain.ErrInvitationNotFound()
	case 2:
		return nil, domain.ErrInvitationNotPending()
	case 3:
		return nil, domain.ErrInvitationSelfAccept()
	case 4:
		return nil, domain.ErrInvitationProjectUnclaimed()
	case 5:
		return nil, domain.ErrInvitationPlatformRequired()
	default:
		return nil, domain.ErrNotImplemented()
	}
}

func (h *Handler) RejectInvitation(ctx context.Context, req *api.InvitationTokenRequest) (api.RejectInvitationRes, error) {
	_ = req
	switch invitationStubPhase {
	case 1:
		return nil, domain.ErrInvitationNotFound()
	case 2:
		return nil, domain.ErrInvitationNotPending()
	default:
		return nil, domain.ErrNotImplemented()
	}
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
