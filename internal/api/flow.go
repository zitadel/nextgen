package api

import (
	"context"
	"errors"
	"fmt"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func (h Handler) CreateFlow(ctx context.Context, req *api.CreateFlowRequest) (api.CreateFlowRes, error) {
	purpose, err := domain.FlowDefinitionPurposeString(string(req.Purpose))
	if err != nil {
		return &api.ErrorDetails{
			Code:    "invalid_purpose",
			Message: fmt.Sprintf("unknown purpose %q", req.Purpose),
		}, nil
	}

	resolveReq := service.ResolveFlowRequest{
		ProjectID: string(req.ProjectID),
		Purpose:   purpose,
		Hint:      buildResolveHint(req.Hint),
	}
	if name, ok := req.FlowDefinitionName.Get(); ok {
		resolveReq.Name = &name
	}
	if v, ok := req.SchemaVersion.Get(); ok {
		resolveReq.SchemaVersion = &v
	}
	if id, ok := req.AuthRequestID.Get(); ok {
		resolveReq.AuthRequestID = &id
	}

	def, err := h.flowService.Resolve(ctx, resolveReq)
	if err != nil {
		return nil, mapResolveError(err)
	}

	// Execution is intentionally stopped here. The service resolved a
	// definition; emitting steps + cookies is the next slice of work.
	return &api.ErrorDetails{
		Code:    "flow_execution_not_implemented",
		Message: fmt.Sprintf("selected flow %q (version %s, id %s); execution not yet implemented", def.Name, def.SchemaVersion, def.ID),
	}, nil
}

func buildResolveHint(opt api.OptFlowHint) service.ResolveFlowHint {
	h, ok := opt.Get()
	if !ok {
		return service.ResolveFlowHint{}
	}
	out := service.ResolveFlowHint{}
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

// mapResolveError translates a Resolve error into an HTTP status code.
// The ogen-generated handler unwraps *api.ErrorDetailsStatusCode from the
// error return path and writes its StatusCode + Response verbatim; the
// success-path *api.ErrorDetails fallback would otherwise force every
// failure to HTTP 400.
func mapResolveError(err error) error {
	switch {
	case errors.Is(err, domain.ErrFlowDefinitionNotFound):
		return &api.ErrorDetailsStatusCode{
			StatusCode: 404,
			Response: api.ErrorDetails{
				Code:    "flow_not_found",
				Message: err.Error(),
			},
		}
	case errors.Is(err, domain.ErrFlowDefinitionPurposeMismatch):
		return &api.ErrorDetailsStatusCode{
			StatusCode: 400,
			Response: api.ErrorDetails{
				Code:    "purpose_mismatch",
				Message: err.Error(),
			},
		}
	default:
		return &api.ErrorDetailsStatusCode{
			StatusCode: 500,
			Response: api.ErrorDetails{
				Code:    "internal_error",
				Message: err.Error(),
			},
		}
	}
}
