package api

import (
	"context"
	"errors"
	"net/http"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func (h *Handler) CreateProject(ctx context.Context, req *api.CreateProjectRequest) (api.CreateProjectRes, error) {
	project, err := h.projectService.Create(ctx, req.Name, req.PreviewOrigins, req.SeedDefaults.Or(true))
	if err != nil {
		return nil, err
	}

	dek, err := h.keyService.GetProjectDEKCrypter(ctx, project.ID)
	if err != nil {
		return nil, err
	}

	projectSecret, err := project.ProjectSecret(dek)
	if err != nil {
		return nil, err
	}
	previewSecret, err := project.PreviewSecret(dek)
	if err != nil {
		return nil, err
	}

	return &api.CreateProjectResponse{
		ID:             project.ID,
		ProjectSecret:  projectSecret,
		PreviewSecret:  previewSecret,
		PreviewOrigins: project.PreviewOrigins,
		CreatedAt:      project.CreatedAt,
	}, nil
}

func (h *Handler) GetProject(ctx context.Context, params api.GetProjectParams) (api.GetProjectRes, error) {
	if err := requireProjectAccess(ctx, string(params.ProjectID), projectAccess, opRead); err != nil {
		return nil, err
	}
	project, err := h.projectService.Get(ctx, string(params.ProjectID))
	if err != nil {
		// The guard already bound the request to the token's own project, so
		// this only fires if that project vanished mid-request; answer with
		// the same proj.not_found the guard uses so the two are inseparable.
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrProjectNotFound()
		}
		return h.NewError(ctx, err), nil
	}
	return &api.GetProjectResponse{
		ID:        project.ID,
		CreatedAt: project.CreatedAt,
		UpdatedAt: project.UpdatedAt,
	}, nil
}

// ------------------ Errors ---------------

func projectErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrProjectNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case domain.ErrProjectPermissionDenied().Code:
		return errorResponseWithStatusCode(http.StatusForbidden, err)
	case domain.ErrProjectNameInvalid().Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	default:
		return internalErrorResponse(err)
	}
}
