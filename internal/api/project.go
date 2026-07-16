package api

import (
	"context"
	"errors"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func (h *Handler) CreateProject(ctx context.Context, req *api.CreateProjectRequest) (api.CreateProjectRes, error) {
	project, err := h.projectService.Create(ctx, req.PreviewOrigins, req.SeedDefaults.Or(true))
	if err != nil {
		return nil, err
	}

	dek, err := h.keyService.GetProjectDEKCrypter(ctx, service.GetProjectDEKInput{ProjectID: project.ID})
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
	project, err := h.projectService.Get(ctx, string(params.ProjectID))
	if err != nil {
		if notFound, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return &api.GetProjectNotFound{
				Code:    "not_found",
				Message: "project not found: " + notFound.Error(),
			}, nil
		}
		return h.NewError(ctx, err), nil
	}
	return &api.GetProjectResponse{
		ID:        project.ID,
		CreatedAt: project.CreatedAt,
		UpdatedAt: project.UpdatedAt,
	}, nil
}
