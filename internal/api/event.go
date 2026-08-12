package api

import (
	"context"
	"net/http"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/events"
)

func (h *Handler) ListEvents(ctx context.Context, params api.ListEventsParams) (api.ListEventsRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), eventsAccess, opRead); err != nil {
		return nil, err
	}

	req := service.ListEventsRequest{
		ProjectID: string(params.ProjectID),
		Limit:     int(params.Limit.Value),
		PageToken: string(params.PageToken.Value),
	}
	if len(params.Category) > 0 {
		req.Categories = make([]string, len(params.Category))
		for i, c := range params.Category {
			req.Categories[i] = string(c)
		}
	}
	if len(params.EventType) > 0 {
		req.EventTypes = append([]string(nil), params.EventType...)
	}
	if v, ok := params.ActorID.Get(); ok {
		req.ActorID = v
	}
	if v, ok := params.ClientID.Get(); ok {
		req.ClientID = v
	}
	if v, ok := params.SessionID.Get(); ok {
		req.SessionID = v
	}
	if v, ok := params.FlowID.Get(); ok {
		req.FlowID = v
	}
	if v, ok := params.RequestID.Get(); ok {
		req.RequestID = v
	}
	if v, ok := params.Fingerprint.Get(); ok {
		req.Fingerprint = v
	}
	if v, ok := params.EntityType.Get(); ok {
		req.EntityType = v
	}
	if v, ok := params.EntityID.Get(); ok {
		req.EntityID = v
	}
	if v, ok := params.TeamID.Get(); ok {
		req.TeamID = v
	}
	if v, ok := params.CreatedAfter.Get(); ok {
		t := v
		req.CreatedAfter = &t
	}
	if v, ok := params.CreatedBefore.Get(); ok {
		t := v
		req.CreatedBefore = &t
	}

	result, err := h.eventService.List(ctx, req)
	if err != nil {
		return nil, err
	}

	resp := &api.ListEventsResponse{
		Data: make([]api.Event, 0, len(result.Events)),
	}
	for _, e := range result.Events {
		item, err := eventToAPI(e)
		if err != nil {
			return nil, err
		}
		resp.Data = append(resp.Data, *item)
	}
	if result.NextPageToken != "" {
		resp.NextPageToken = api.NewOptNilPageToken(api.PageToken(result.NextPageToken))
	}
	return resp, nil
}

func (h *Handler) GetEvent(ctx context.Context, params api.GetEventParams) (api.GetEventRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), eventsAccess, opRead); err != nil {
		return nil, err
	}
	event, err := h.eventService.Get(ctx, string(params.ProjectID), params.ID)
	if err != nil {
		return nil, err
	}
	return eventToAPI(event)
}

// eventToAPI maps a domain event onto the OpenAPI Event sum type by encoding
// the wire JSON and letting ogen's discriminator decode select the variant.
func eventToAPI(e *domain.Event) (*api.Event, error) {
	raw, err := events.MarshalWire(e)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to encode event for API")
	}
	var out api.Event
	if err := out.UnmarshalJSON(raw); err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to map event to API type")
	}
	return &out, nil
}

func eventErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrEventNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case domain.ErrEventInvalid(nil, nil).Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	case domain.ErrEventPermissionDenied().Code:
		return errorResponseWithStatusCode(http.StatusForbidden, err)
	default:
		return internalErrorResponse(err)
	}
}
