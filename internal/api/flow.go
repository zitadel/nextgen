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

	resolveReq := serviceflow.ResolveRequest{
		ProjectID: string(req.ProjectID),
		Purpose:   purpose,
		Hint:      buildResolveHint(req.Hint),
	}
	if slug, ok := req.Slug.Get(); ok {
		resolveReq.Name = &slug
	}
	if v, ok := req.SchemaVersion.Get(); ok {
		resolveReq.SchemaVersion = &v
	}
	if id, ok := req.AuthRequestID.Get(); ok {
		resolveReq.AuthRequestID = &id
	}

	def, err := h.flowService.Resolve(ctx, resolveReq)
	if err != nil {
		return mapResolveError(err), nil
	}

	// Execution is intentionally stopped here. The service resolved a
	// definition; emitting steps + cookies is the next slice of work.
	return &api.ErrorDetails{
		Code:    "flow_execution_not_implemented",
		Message: fmt.Sprintf("selected flow %q (version %s, id %s); execution not yet implemented", def.Name, def.SchemaVersion, def.ID),
	}, nil
}

func buildResolveHint(opt api.OptFlowHint) serviceflow.ResolveHint {
	h, ok := opt.Get()
	if !ok {
		return serviceflow.ResolveHint{}
	}
	out := serviceflow.ResolveHint{}
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

func mapResolveError(err error) *api.ErrorDetails {
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
