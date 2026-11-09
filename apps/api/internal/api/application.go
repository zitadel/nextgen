package api

import (
	"context"
	"net/http"

	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

// CreateApplication ignores params.IdempotencyKey: rotating the secrets of the
// clients a keyed request created comes in its own change.
func (h *Handler) CreateApplication(ctx context.Context, req *api.CreateApplicationRequest, params api.CreateApplicationParams) (api.CreateApplicationRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), applicationAccess, opWrite); err != nil {
		return nil, err
	}
	document, err := req.Application.MarshalJSON()
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to encode application")
	}
	result, err := h.applicationService.CreateOrRevise(ctx, string(params.ProjectID), document)
	if err != nil {
		return nil, err
	}
	app, err := toAPIApplicationResponse(result.Application)
	if err != nil {
		return nil, err
	}
	resp := api.CreateApplicationResponse{
		ID:         app.ID,
		RevisionID: app.RevisionID,
		Slug:       app.Slug,
		CreatedAt:  app.CreatedAt,
		UpdatedAt:  app.UpdatedAt,
		Definition: app.Definition,
	}
	for _, secret := range result.Secrets {
		resp.ClientSecrets = append(resp.ClientSecrets, api.ApplicationClientSecret{Client: secret.Slug, ClientID: secret.ClientID, Secret: secret.Secret})
	}
	if result.Created {
		created := api.CreateApplicationCreated(resp)
		return &created, nil
	}
	revised := api.CreateApplicationOK(resp)
	return &revised, nil
}

func (h *Handler) GetApplicationById(ctx context.Context, params api.GetApplicationByIdParams) (api.GetApplicationByIdRes, error) {
	projectID, err := h.requireResourceAccessInProject(ctx, string(params.ProjectID), params.ID, applicationAccess, opRead)
	if err != nil {
		return nil, err
	}
	entity, err := h.applicationService.Get(ctx, projectID, params.ID)
	if err != nil {
		return nil, err
	}
	resp, err := toAPIApplicationResponse(entity)
	if err != nil {
		return nil, err
	}
	return &resp, nil
}

func toAPIApplicationResponse(entity *domain.Application) (api.ApplicationResponse, error) {
	resp := api.ApplicationResponse{
		ID:         entity.ID,
		RevisionID: entity.RevisionID,
		Slug:       entity.Slug,
		CreatedAt:  entity.CreatedAt,
		UpdatedAt:  entity.UpdatedAt,
	}
	if err := resp.Definition.UnmarshalJSON(entity.Document); err != nil {
		return api.ApplicationResponse{}, domain.ErrInternal(err).WithMessage("failed to decode stored application")
	}
	return resp, nil
}

func applicationErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrApplicationNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case domain.ErrApplicationFieldImmutable(nil).Code, domain.ErrApplicationInvalid(nil, nil).Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	case domain.ErrApplicationPermissionDenied().Code:
		return errorResponseWithStatusCode(http.StatusForbidden, err)
	case domain.ErrApplicationClientIDTaken().Code, domain.ErrApplicationRevisionConflict().Code:
		return errorResponseWithStatusCode(http.StatusConflict, err)
	default:
		return internalErrorResponse(err)
	}
}
