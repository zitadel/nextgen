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
		return &api.ErrorDetailsStatusCode{
			StatusCode: 500,
			Response: api.ErrorDetails{
				Code:    "internal_error",
				Message: err.Error(),
			},
		}, nil
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
		return &api.ErrorDetailsStatusCode{
			StatusCode: 500,
			Response: api.ErrorDetails{
				Code:    "internal_error",
				Message: err.Error(),
			},
		}, nil
	}
	return &api.GetProjectResponse{
		ID:        project.ID,
		CreatedAt: project.CreatedAt,
		UpdatedAt: project.UpdatedAt,
	}, nil
}
