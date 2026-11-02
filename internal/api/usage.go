package api

import (
	"context"
	"net/http"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// WithUsageService attaches the usage read (ADR 086); without it GetUsage
// answers as unimplemented.
func (h *Handler) WithUsageService(s *service.UsageService) *Handler {
	h.usageService = s
	return h
}

func (h *Handler) GetUsage(ctx context.Context, params api.GetUsageParams) (api.GetUsageRes, error) {
	if h.usageService == nil {
		return nil, domain.ErrNotImplemented()
	}
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), usageAccess, opRead); err != nil {
		return nil, err
	}
	granularity := service.UsageByDay
	if v, ok := params.Granularity.Get(); ok {
		granularity = service.UsageGranularity(v)
	}
	result, err := h.usageService.Get(ctx, service.GetUsageRequest{
		ProjectID:   string(params.ProjectID),
		From:        params.From,
		To:          params.To,
		Granularity: granularity,
		Meters:      params.Meter,
	})
	if err != nil {
		return nil, err
	}

	resp := api.UsageResponse{Data: make([]api.UsageBucket, 0, len(result.Buckets))}
	for _, bucket := range result.Buckets {
		resp.Data = append(resp.Data, api.UsageBucket{Meter: bucket.Meter, Start: bucket.Start, Value: bucket.Value})
	}
	if result.SealedThrough != nil {
		resp.SealedThrough = api.NewNilDateTime(*result.SealedThrough)
	} else {
		resp.SealedThrough.SetToNull()
	}
	if result.TeamID != nil {
		resp.TeamID = api.NewNilTeamID(api.TeamID(*result.TeamID))
	} else {
		resp.TeamID.SetToNull()
	}
	return &api.UsageResponseHeaders{
		CacheControl: api.NewOptString(sessionStateCacheControl),
		Response:     resp,
	}, nil
}

func usageErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrUsageInvalid(nil).Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	case domain.ErrUsageNotFound().Code, domain.ErrUsageDisabled().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case domain.ErrUsagePermissionDenied().Code:
		return errorResponseWithStatusCode(http.StatusForbidden, err)
	default:
		return internalErrorResponse(err)
	}
}
