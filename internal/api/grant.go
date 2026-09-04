package api

import (
	"context"
	"net/http"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Handler) CreateGrant(ctx context.Context, req *api.CreateGrantRequest, params api.CreateGrantParams) (api.CreateGrantRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), grantAccess, opWrite); err != nil {
		return nil, err
	}
	principalType, err := grantPrincipalType(req.PrincipalType)
	if err != nil {
		return nil, err
	}
	input := service.CreateGrantInput{
		ProjectID:     string(params.ProjectID),
		PrincipalType: principalType,
		PrincipalID:   req.PrincipalID,
		Relation:      string(req.Relation),
	}
	if v, ok := req.ExpiresAt.Get(); ok {
		input.ExpiresAt = &v
	}
	asgn, err := h.grantService.Create(ctx, input)
	if err != nil {
		return nil, err
	}
	return grantResponse(asgn), nil
}

func (h *Handler) GetGrant(ctx context.Context, params api.GetGrantParams) (api.GetGrantRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), grantAccess, opRead); err != nil {
		return nil, err
	}
	asgn, err := h.grantService.Get(ctx, string(params.ProjectID), params.ID)
	if err != nil {
		return nil, err
	}
	return grantResponse(asgn), nil
}

func (h *Handler) DeleteGrant(ctx context.Context, params api.DeleteGrantParams) (api.DeleteGrantRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), grantAccess, opDelete); err != nil {
		return nil, err
	}
	if err := h.grantService.Revoke(ctx, string(params.ProjectID), params.ID); err != nil {
		return nil, err
	}
	return &api.DeleteGrantNoContent{}, nil
}

func grantResponse(asgn *domain.AuthzAssignment) *api.Grant {
	resp := &api.Grant{
		ID:            asgn.ID,
		ProjectID:     asgn.ProjectID,
		PrincipalType: api.GrantPrincipalType(asgn.PrincipalType.String()),
		PrincipalID:   asgn.PrincipalID,
		ObjectType:    api.GrantObjectTypeProject,
		Relation:      api.GrantRelation(asgn.Relation),
		CreatedAt:     asgn.CreatedAt,
	}
	if asgn.ExpiresAt != nil {
		resp.ExpiresAt = api.NewOptNilDateTime(*asgn.ExpiresAt)
	}
	return resp
}

func grantPrincipalType(t api.CreateGrantRequestPrincipalType) (domain.AuthzPrincipalType, error) {
	switch t {
	case api.CreateGrantRequestPrincipalTypeUser:
		return domain.AuthzPrincipalTypeUser, nil
	case api.CreateGrantRequestPrincipalTypeTeam:
		return domain.AuthzPrincipalTypeTeam, nil
	default:
		return "", domain.ErrGrantInvalid().WithDetails("principal_type must be user or team")
	}
}

func grantErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrGrantInvalid().Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	case domain.ErrGrantNotFound().Code, domain.ErrGrantPrincipalNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case domain.ErrGrantAlreadyExists().Code:
		return errorResponseWithStatusCode(http.StatusConflict, err)
	case domain.ErrGrantPermissionDenied().Code:
		return errorResponseWithStatusCode(http.StatusForbidden, err)
	default:
		return internalErrorResponse(err)
	}
}
