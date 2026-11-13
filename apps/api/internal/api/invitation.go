package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"time"

	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/authz/resolver"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// WithInvitationService wires the invitation endpoints, like
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
		RespondedBy:   inv.RespondedBy,
		RespondedAt:   inv.RespondedAt,
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
	for _, status := range params.Status {
		req.Statuses = append(req.Statuses, domain.InvitationStatus(status))
	}
	if v, ok := params.Type.Get(); ok {
		req.Type = new(domain.InvitationType(v))
	}
	req.ExpandInviter = slices.Contains(params.Expand, api.InvitationExpandInviter)
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
		if req.ExpandInviter {
			// Present, and null for a project secret, only when expanded.
			if inv.Inviter != nil {
				mapped.InvitationProjectMember.Inviter.SetTo(userRefToAPI(*inv.Inviter))
			} else {
				mapped.InvitationProjectMember.Inviter.SetToNull()
			}
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
	if inv.RespondedBy != nil {
		resp.RespondedBy.SetTo(*inv.RespondedBy)
	} else {
		resp.RespondedBy.SetToNull()
	}
	if inv.RespondedAt != nil {
		resp.RespondedAt.SetTo(*inv.RespondedAt)
	} else {
		resp.RespondedAt.SetToNull()
	}
	return resp
}

func (h *Handler) LookupInvitation(ctx context.Context, req *api.InvitationTokenRequest) (api.LookupInvitationRes, error) {
	userID, err := h.invitationRedeemer(ctx)
	if err != nil {
		return nil, err
	}
	found, err := h.invitationService.Lookup(ctx, req.Token, userID)
	if err != nil {
		return nil, err
	}
	if found.Type != domain.InvitationTypeProjectMember || found.ProjectMember == nil {
		return nil, domain.ErrInternal(fmt.Errorf("invitation %q has an unknown type %q", found.ID, found.Type))
	}
	view := api.InvitationLookupProjectMemberResponse{
		ProjectID:   api.ProjectID(found.ProjectID),
		ProjectName: found.ProjectName,
		ExpiresAt:   found.ExpiresAt,
		Status:      api.InvitationStatus(found.StatusAt(time.Now())),
		Type:        api.InvitationLookupProjectMemberResponseTypeProjectMember,
		ProjectMember: api.InvitationProjectMemberPayload{
			Relation: api.InvitationProjectMemberPayloadRelation(found.ProjectMember.Relation),
		},
	}
	if found.CreatedBy != nil {
		view.CreatedBy.SetTo(*found.CreatedBy)
	} else {
		view.CreatedBy.SetToNull()
	}
	if found.CreatedByType != nil {
		view.CreatedByType.SetTo(api.InvitationLookupProjectMemberResponseCreatedByType(*found.CreatedByType))
	} else {
		view.CreatedByType.SetToNull()
	}
	if found.Inviter != nil {
		view.Inviter.SetTo(userRefToAPI(*found.Inviter))
	} else {
		view.Inviter.SetToNull()
	}
	resp := api.NewInvitationLookupProjectMemberResponseInvitationLookupResponse(view)
	return &resp, nil
}

func (h *Handler) AcceptInvitation(ctx context.Context, req *api.InvitationTokenRequest) (api.AcceptInvitationRes, error) {
	userID, err := h.invitationRedeemer(ctx)
	if err != nil {
		return nil, err
	}
	// A literal, not the method value: gen_openapi_errors follows a func
	// literal argument.
	accepted, err := h.invitationService.Accept(ctx, req.Token, userID, func(ctx context.Context, stmts service.AllStatements, projectID, inviterID string) (bool, error) {
		return h.inviterIsAdmin(ctx, stmts, projectID, inviterID)
	})
	if err != nil {
		return nil, err
	}
	return invitationResponse(accepted, time.Now())
}

func (h *Handler) RejectInvitation(ctx context.Context, req *api.InvitationTokenRequest) (api.RejectInvitationRes, error) {
	userID, err := h.invitationRedeemer(ctx)
	if err != nil {
		return nil, err
	}
	rejected, err := h.invitationService.Reject(ctx, req.Token, userID)
	if err != nil {
		return nil, err
	}
	return invitationResponse(rejected, time.Now())
}

// invitationRedeemer is the user redeeming a link: only a session of a user
// homed in the platform project may (ADR 086 §10).
func (h *Handler) invitationRedeemer(ctx context.Context) (string, error) {
	token, _ := sessionTokenFromContext(ctx)
	self, err := domain.SelfFromSession(token, time.Now())
	if err != nil {
		return "", invalidSessionCredential(err)
	}
	if h.platformProjectID != "" && self.ProjectID() != h.platformProjectID {
		return "", invalidSessionCredential(domain.ErrSessionTokenInvalid())
	}
	return self.UserID(), nil
}

// inviterIsAdmin asks whether the invitation's creator still holds admin on
// the project, as POST /invitations checked when it was created.
func (h *Handler) inviterIsAdmin(ctx context.Context, stmts service.AllStatements, projectID, userID string) (bool, error) {
	home, err := stmts.GetResourceScope(ctx, userID)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return false, nil
		}
		return false, err
	}
	if home.ResourceKind != domain.ResourceKindUser {
		return false, nil
	}
	req := resolver.Request{
		PrincipalType: domain.AuthzPrincipalTypeUser,
		PrincipalID:   userID,
		ProjectID:     projectID,
		HomeProjectID: home.ProjectID,
		ObjectType:    "project",
		Relation:      projectRelation(opDelete),
	}
	if h.platformProjectID != "" && home.ProjectID == h.platformProjectID {
		req.PlatformProjectID = h.platformProjectID
	}
	dec, err := resolver.New().Check(ctx, stmts, req)
	if err != nil {
		return false, domain.ErrInternal(err).WithMessage("authz permission check failed")
	}
	return dec == resolver.DecisionAllow, nil
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
