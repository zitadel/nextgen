package api

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-faster/jx"
	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
	"github.com/zitadel/nextgen/internal/storage/events"
)

func (h *Handler) ListEvents(ctx context.Context, params api.ListEventsParams) (api.ListEventsRes, error) {
	if err := requireProjectAccess(ctx, string(params.ProjectID), eventsAccess, opRead); err != nil {
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
	if err := requireProjectAccess(ctx, string(params.ProjectID), eventsAccess, opRead); err != nil {
		return nil, err
	}
	event, err := h.eventService.Get(ctx, string(params.ProjectID), params.ID)
	if err != nil {
		return nil, err
	}
	return eventToAPI(event)
}

func eventToAPI(e *domain.Event) (*api.Event, error) {
	payload, err := rawObjectToEventPayload(e.Payload)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to decode event payload")
	}
	out := &api.Event{
		ID:         e.ID,
		ProjectID:  api.ProjectID(e.ProjectID),
		EventType:  api.EventEventType(e.EventType),
		Category:   api.EventCategory(e.Category),
		OccurredAt: e.OccurredAt,
		CreatedAt:  e.CreatedAt,
		ClientID:   e.ClientID,
		Payload:    payload,
	}
	if e.TeamID != nil {
		out.TeamID = api.NewOptNilString(*e.TeamID)
	}
	if e.ActorID != nil {
		out.ActorID = api.NewOptNilString(*e.ActorID)
	}
	if e.ActorType != nil {
		out.ActorType = api.NewOptNilEventActorType(api.EventActorType(*e.ActorType))
	}
	if e.EntityType != nil {
		out.EntityType = api.NewOptNilString(*e.EntityType)
	}
	if e.EntityID != nil {
		out.EntityID = api.NewOptNilString(*e.EntityID)
	}
	if e.TokenID != "" {
		out.TokenID = api.NewOptString(e.TokenID)
	}
	if e.DelegationType != "" {
		out.DelegationType = api.NewOptString(e.DelegationType)
	}
	if e.DelegationID != "" {
		out.DelegationID = api.NewOptString(e.DelegationID)
	}
	if e.Grantor != "" {
		out.Grantor = api.NewOptString(e.Grantor)
	}
	if e.Fingerprint != "" {
		out.Fingerprint = api.NewOptString(e.Fingerprint)
	}
	if e.RequestID != nil {
		out.RequestID = api.NewOptNilString(*e.RequestID)
	}
	if e.SessionID != nil {
		out.SessionID = api.NewOptNilString(*e.SessionID)
	}
	if e.FlowID != nil {
		out.FlowID = api.NewOptNilString(*e.FlowID)
	}
	if meta, ok, err := rawObjectToOptMetadata(e.Metadata); err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to decode event metadata")
	} else if ok {
		out.Metadata = api.NewOptEventMetadata(meta)
	}
	return out, nil
}

func rawObjectToEventPayload(raw json.RawMessage) (api.EventPayload, error) {
	raw = events.NormalizeJSON(raw)
	var m map[string]jx.Raw
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, err
	}
	if m == nil {
		m = map[string]jx.Raw{}
	}
	return api.EventPayload(m), nil
}

func rawObjectToOptMetadata(raw json.RawMessage) (api.EventMetadata, bool, error) {
	if len(raw) == 0 || string(raw) == "null" || string(raw) == "{}" {
		return nil, false, nil
	}
	var m map[string]jx.Raw
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, false, err
	}
	if len(m) == 0 {
		return nil, false, nil
	}
	return api.EventMetadata(m), true, nil
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
