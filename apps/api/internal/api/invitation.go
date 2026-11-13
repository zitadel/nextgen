package api

import (
	"context"
	"fmt"
	"net/http"
	"time"

	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// invitationStubPhase stays 0; its other cases only feed gen_openapi_errors
// the token endpoints' codes until #2853. Keep each switch to its op's set.
var invitationStubPhase int

// WithInvitationService wires the invitation admin endpoints, like
// WithPolicyService.
func (h *Handler) WithInvitationService(s *service.InvitationService) *Handler {
	h.invitationService = s
	return h
}

func (h *Handler) CreateInvitation(ctx context.Context, req api.CreateInvitationRequest, params api.CreateInvitationParams) (api.CreateInvitationRes, error) {
	// Same project.admin check as createGrant (opDelete).
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), invitationAccess, opDelete); err != nil {
		return nil, err
	}
	body, ok := req.GetCreateInvitationProjectMemberRequest()
	if !ok {
		return nil, domain.ErrNotImplemented()
	}
	input := service.CreateInvitationInput{
		ProjectID:            string(params.ProjectID),
		Type:                 domain.InvitationTypeProjectMember,
		ProjectMember:        &domain.InvitationProjectMember{Relation: string(body.ProjectMember.Relation)},
		ReplacesInvitationID: string(body.ReplacesInvitationID.Or("")),
	}
	if metadata, ok := body.Metadata.Get(); ok {
		input.Metadata = &domain.InvitationMetadata{Name: metadata.Name}
	}
	created, err := h.invitationService.Create(ctx, input)
	if err != nil {
		return nil, err
	}
	inv := invitationProjectMemberResponse(&created.Invitation, time.Now())
	resp := api.NewCreateInvitationProjectMemberResponseCreateInvitationResponse(api.CreateInvitationProjectMemberResponse{
		ID:            inv.ID,
		ProjectID:     inv.ProjectID,
		Metadata:      inv.Metadata,
		Status:        inv.Status,
		CreatedBy:     inv.CreatedBy,
		CreatedAt:     inv.CreatedAt,
		ExpiresAt:     inv.ExpiresAt,
		JourneyID:     inv.JourneyID,
		AcceptedBy:    inv.AcceptedBy,
		AcceptedAt:    inv.AcceptedAt,
		RejectedAt:    inv.RejectedAt,
		Type:          api.CreateInvitationProjectMemberResponseTypeProjectMember,
		ProjectMember: inv.ProjectMember,
		Link:          created.Link,
	})
	if v, ok := inv.CreatedByType.Get(); ok {
		resp.CreateInvitationProjectMemberResponse.CreatedByType.SetTo(api.CreateInvitationProjectMemberResponseCreatedByType(v))
	} else {
		resp.CreateInvitationProjectMemberResponse.CreatedByType.SetToNull()
	}
	return &resp, nil
}

func (h *Handler) ListInvitations(ctx context.Context, params api.ListInvitationsParams) (api.ListInvitationsRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), invitationAccess, opDelete); err != nil {
		return nil, err
	}
	req := service.ListInvitationsRequest{
		ProjectID: string(params.ProjectID),
		Limit:     int(params.Limit.Or(0)),
		PageToken: string(params.PageToken.Or("")),
	}
	// Several statuses and expand=inviter land with the implementation.
	if len(params.Status) > 1 || len(params.Expand) > 0 {
		return nil, domain.ErrNotImplemented()
	}
	if len(params.Status) == 1 {
		req.Status = new(domain.InvitationStatus(params.Status[0]))
	}
	if v, ok := params.Type.Get(); ok {
		req.Type = new(domain.InvitationType(v))
	}
	listed, err := h.invitationService.List(ctx, req)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	resp := &api.ListInvitationsResponse{Invitations: make([]api.Invitation, 0, len(listed.Invitations))}
	for _, inv := range listed.Invitations {
		mapped, err := invitationResponse(inv, now)
		if err != nil {
			return nil, err
		}
		resp.Invitations = append(resp.Invitations, *mapped)
	}
	if listed.NextPageToken != "" {
		resp.NextPageToken = api.NewOptNilPageToken(api.PageToken(listed.NextPageToken))
	}
	return resp, nil
}

func (h *Handler) GetInvitation(ctx context.Context, params api.GetInvitationParams) (api.GetInvitationRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), invitationAccess, opDelete); err != nil {
		return nil, err
	}
	inv, err := h.invitationService.Get(ctx, string(params.ProjectID), string(params.ID))
	if err != nil {
		return nil, err
	}
	return invitationResponse(inv, time.Now())
}

func (h *Handler) CancelInvitation(ctx context.Context, params api.CancelInvitationParams) (api.CancelInvitationRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), invitationAccess, opDelete); err != nil {
		return nil, err
	}
	if err := h.invitationService.Cancel(ctx, string(params.ProjectID), string(params.ID)); err != nil {
		return nil, err
	}
	return &api.CancelInvitationNoContent{}, nil
}

func invitationResponse(inv *service.Invitation, now time.Time) (*api.Invitation, error) {
	if inv.Type != domain.InvitationTypeProjectMember || inv.ProjectMember == nil {
		return nil, domain.ErrInternal(fmt.Errorf("invitation %q has an unknown type %q", inv.ID, inv.Type))
	}
	resp := api.NewInvitationProjectMemberInvitation(invitationProjectMemberResponse(inv, now))
	return &resp, nil
}

func invitationProjectMemberResponse(inv *service.Invitation, now time.Time) api.InvitationProjectMember {
	resp := api.InvitationProjectMember{
		ID:        api.InvitationID(inv.ID),
		ProjectID: api.ProjectID(inv.ProjectID),
		Status:    api.InvitationStatus(inv.StatusAt(now)),
		CreatedAt: inv.CreatedAt,
		ExpiresAt: inv.ExpiresAt,
		JourneyID: inv.JourneyID,
		Type:      api.InvitationProjectMemberTypeProjectMember,
		ProjectMember: api.InvitationProjectMemberPayload{
			Relation: api.InvitationProjectMemberPayloadRelation(inv.ProjectMember.Relation),
		},
	}
	if inv.Metadata != nil {
		resp.Metadata.SetTo(api.InvitationMetadata{Name: inv.Metadata.Name})
	} else {
		resp.Metadata.SetToNull()
	}
	if inv.CreatedBy != nil {
		resp.CreatedBy.SetTo(*inv.CreatedBy)
	} else {
		resp.CreatedBy.SetToNull()
	}
	if inv.CreatedByType != nil {
		resp.CreatedByType.SetTo(api.InvitationProjectMemberCreatedByType(*inv.CreatedByType))
	} else {
		resp.CreatedByType.SetToNull()
	}
	if inv.AcceptedBy != nil {
		resp.AcceptedBy.SetTo(*inv.AcceptedBy)
	} else {
		resp.AcceptedBy.SetToNull()
	}
	if inv.AcceptedAt != nil {
		resp.AcceptedAt.SetTo(*inv.AcceptedAt)
	} else {
		resp.AcceptedAt.SetToNull()
	}
	resp.RejectedAt.SetToNull()
	return resp
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
		// Unknown and finished tokens share the public not_found.
		return nil, domain.ErrInvitationNotFound()
	case 2:
		return nil, domain.ErrInvitationSelfAccept()
	case 3:
		return nil, domain.ErrInvitationProjectUnclaimed()
	case 4:
		return nil, domain.ErrInvitationPlatformRequired()
	case 5:
		return nil, domain.ErrInvitationInviterNotAdmin()
	case 6:
		// Accepting emits invitation.accepted.
		return nil, domain.ErrEventInvalid(nil, nil)
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
		return nil, domain.ErrInvitationSelfReject()
	case 3:
		// Declining emits invitation.rejected.
		return nil, domain.ErrEventInvalid(nil, nil)
	default:
		return nil, domain.ErrNotImplemented()
	}
}

func invitationErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrInvitationInvalid().Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	case domain.ErrInvitationNotPending().Code:
		// Finished invitations must not leak status on the wire; same public
		// body as a miss (ADR 086 opaque token / cancel answers).
		return errorResponseWithStatusCode(http.StatusNotFound, domain.ErrInvitationNotFound())
	case domain.ErrInvitationNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case domain.ErrInvitationPermissionDenied().Code,
		domain.ErrInvitationSelfAccept().Code,
		domain.ErrInvitationSelfReject().Code,
		domain.ErrInvitationInviterNotAdmin().Code:
		return errorResponseWithStatusCode(http.StatusForbidden, err)
	case domain.ErrInvitationProjectUnclaimed().Code,
		domain.ErrInvitationPendingLimit().Code,
		domain.ErrInvitationPlatformRequired().Code:
		return errorResponseWithStatusCode(http.StatusConflict, err)
	default:
		return internalErrorResponse(err)
	}
}
