package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

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

// eventToAPI maps a domain event onto the OpenAPI Event sum type by encoding
// the wire JSON and letting ogen's discriminator decode select the variant.
func eventToAPI(e *domain.Event) (*api.Event, error) {
	raw, err := marshalDomainEvent(e)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to encode event for API")
	}
	var out api.Event
	if err := out.UnmarshalJSON(raw); err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to map event to API type")
	}
	return &out, nil
}

func marshalDomainEvent(e *domain.Event) ([]byte, error) {
	m := map[string]any{
		"id":          e.ID,
		"project_id":  e.ProjectID,
		"event_type":  string(e.EventType),
		"category":    string(e.Category),
		"occurred_at": e.OccurredAt.UTC().Format(time.RFC3339Nano),
		"created_at":  e.CreatedAt.UTC().Format(time.RFC3339Nano),
		"client_id":   e.ClientID,
		"payload":     json.RawMessage(events.NormalizeJSON(e.Payload)),
	}
	if e.TeamID != nil {
		m["team_id"] = *e.TeamID
	}
	if e.ActorID != nil {
		m["actor_id"] = *e.ActorID
	}
	if e.ActorType != nil {
		m["actor_type"] = string(*e.ActorType)
	}
	if e.EntityType != nil {
		m["entity_type"] = *e.EntityType
	}
	if e.EntityID != nil {
		m["entity_id"] = *e.EntityID
	}
	if e.TokenID != "" {
		m["token_id"] = e.TokenID
	}
	if e.DelegationType != "" {
		m["delegation_type"] = e.DelegationType
	}
	if e.DelegationID != "" {
		m["delegation_id"] = e.DelegationID
	}
	if e.Grantor != "" {
		m["grantor"] = e.Grantor
	}
	if e.Fingerprint != "" {
		m["fingerprint"] = e.Fingerprint
	}
	if e.RequestID != nil {
		m["request_id"] = *e.RequestID
	}
	if e.SessionID != nil {
		m["session_id"] = *e.SessionID
	}
	if e.FlowID != nil {
		m["flow_id"] = *e.FlowID
	}
	meta := events.NormalizeJSON(e.Metadata)
	if len(meta) > 0 && string(meta) != "{}" && string(meta) != "null" {
		m["metadata"] = json.RawMessage(meta)
	}
	return json.Marshal(m)
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
