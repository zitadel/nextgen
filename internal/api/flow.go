package api

import (
	"context"
	"errors"
	"fmt"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	serviceflow "github.com/zitadel/nextgen/internal/service/flow"
)

func (h Handler) CreateFlow(ctx context.Context, req *api.CreateFlowRequest) (api.CreateFlowRes, error) {
	purpose, err := domain.FlowDefinitionPurposeString(string(req.Purpose))
	if err != nil {
		return &api.ErrorDetails{
			Code:    "invalid_purpose",
			Message: fmt.Sprintf("unknown purpose %q", req.Purpose),
		}, nil
	}

	selReq := serviceflow.SelectorRequest{
		ProjectID: string(req.ProjectID),
		Purpose:   purpose,
		Hint:      buildSelectorHint(req.Hint),
	}
	if slug, ok := req.Slug.Get(); ok {
		selReq.Name = &slug
	}
	if v, ok := req.SchemaVersion.Get(); ok {
		selReq.SchemaVersion = &v
	}
	if id, ok := req.AuthRequestID.Get(); ok {
		selReq.AuthRequestID = &id
	}

	def, err := h.flowSelector.Resolve(ctx, selReq)
	if err != nil {
		return mapSelectorError(err), nil
	}

	// Execution is intentionally stopped here. The selector resolved a
	// definition; emitting steps + cookies is the next slice of work.
	return &api.ErrorDetails{
		Code:    "flow_execution_not_implemented",
		Message: fmt.Sprintf("selected flow %q (version %s, id %s); execution not yet implemented", def.Name, def.SchemaVersion, def.ID),
	}, nil
}

func buildSelectorHint(opt api.OptFlowHint) serviceflow.SelectorHint {
	h, ok := opt.Get()
	if !ok {
		return serviceflow.SelectorHint{}
	}
	out := serviceflow.SelectorHint{}
	if v, ok := h.AppID.Get(); ok {
		out.AppID = &v
	}
	if v, ok := h.TeamID.Get(); ok {
		out.TeamID = &v
	}
	if v, ok := h.UserSchemaID.Get(); ok {
		out.UserSchemaID = &v
	}
	return out
}

func mapSelectorError(err error) *api.ErrorDetails {
	switch {
	case errors.Is(err, domain.ErrFlowDefinitionNotFound):
		return &api.ErrorDetails{
			Code:    "flow_not_found",
			Message: err.Error(),
		}
	case errors.Is(err, domain.ErrFlowDefinitionPurposeMismatch):
		return &api.ErrorDetails{
			Code:    "purpose_mismatch",
			Message: err.Error(),
		}
	default:
		return &api.ErrorDetails{
			Code:    "internal_error",
			Message: err.Error(),
		}
	}
}
