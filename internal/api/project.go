package api

import (
	"context"
	"errors"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/storage/database"
)

func (h Handler) CreateProject(ctx context.Context, req *api.CreateProjectRequest) (api.CreateProjectRes, error) {
	project, err := h.projectService.Create(ctx, req.PreviewOrigins)
	if err != nil {
		return h.NewError(ctx, err), nil
	}
	return &api.CreateProjectResponse{
		ID:             project.ID,
		ProjectSecret:  project.ProjectSecret,
		PreviewSecret:  project.PreviewSecret,
		PreviewOrigins: project.PreviewOrigins,
		CreatedAt:      project.CreatedAt,
	}, nil
}

func (h Handler) GetProject(ctx context.Context, params api.GetProjectParams) (api.GetProjectRes, error) {
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
