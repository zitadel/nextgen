package api

import (
	"context"
	"errors"
	"net/http"
	"time"

	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// WithWebhookService wires the webhook endpoints (ADR 088). A chainable
// setter like WithPolicyService, so NewHandler's call sites stay unchanged;
// without it the endpoints answer an internal error.
func (h *Handler) WithWebhookService(s *service.WebhookService) *Handler {
	h.webhookService = s
	return h
}

// requireWebhookAccess gates a webhook operation on the project the request
// names. A webhook has no access rows of its own, so every operation is
// decided by the project.
func (h *Handler) requireWebhookAccess(ctx context.Context, projectID api.ProjectID, op accessOp) error {
	if err := h.requireProjectAccess(ctx, string(projectID), webhookAccess, op); err != nil {
		return err
	}
	if h.webhookService == nil {
		return domain.ErrInternal(errors.New("webhook service not configured"))
	}
	return nil
}

func (h *Handler) ListWebhooks(ctx context.Context, params api.ListWebhooksParams) (api.ListWebhooksRes, error) {
	if err := h.requireWebhookAccess(ctx, params.ProjectID, opRead); err != nil {
		return nil, err
	}
	result, err := h.webhookService.List(ctx, service.ListWebhooksInput{
		ProjectID: string(params.ProjectID),
		Limit:     int(params.Limit.Or(0)),
		PageToken: string(params.PageToken.Or("")),
	})
	if err != nil {
		return nil, err
	}
	resp := &api.ListWebhooksResponse{Data: make([]api.Webhook, 0, len(result.Items))}
	for _, entity := range result.Items {
		resp.Data = append(resp.Data, *toAPIWebhook(entity))
	}
	if result.NextPageToken != "" {
		resp.NextPageToken = api.NewOptNilPageToken(api.PageToken(result.NextPageToken))
	}
	return resp, nil
}

func (h *Handler) CreateWebhook(ctx context.Context, req *api.CreateWebhookRequest, params api.CreateWebhookParams) (api.CreateWebhookRes, error) {
	if err := h.requireWebhookAccess(ctx, params.ProjectID, opWrite); err != nil {
		return nil, err
	}
	entity, secret, err := h.webhookService.Create(ctx, service.CreateWebhookInput{
		ProjectID:   string(params.ProjectID),
		URL:         string(req.URL),
		Description: req.Description.Or(""),
		EventTypes:  fromAPIWebhookEventTypes(req.EventTypes),
	})
	if err != nil {
		return nil, err
	}
	return toAPIWebhookWithSecret(entity, secret), nil
}

func (h *Handler) GetWebhook(ctx context.Context, params api.GetWebhookParams) (api.GetWebhookRes, error) {
	if err := h.requireWebhookAccess(ctx, params.ProjectID, opRead); err != nil {
		return nil, err
	}
	entity, err := h.webhookService.Get(ctx, string(params.ProjectID), string(params.ID))
	if err != nil {
		return nil, err
	}
	return toAPIWebhook(entity), nil
}

func (h *Handler) UpdateWebhook(ctx context.Context, req *api.UpdateWebhookRequest, params api.UpdateWebhookParams) (api.UpdateWebhookRes, error) {
	if err := h.requireWebhookAccess(ctx, params.ProjectID, opWrite); err != nil {
		return nil, err
	}
	update := domain.WebhookUpdate{EventTypes: fromAPIWebhookEventTypes(req.EventTypes)}
	if url, ok := req.URL.Get(); ok {
		update.URL = new(string(url))
	}
	if description, ok := req.Description.Get(); ok {
		update.Description = &description
	}
	if enabled, ok := req.Enabled.Get(); ok {
		update.Enabled = &enabled
	}
	entity, err := h.webhookService.Update(ctx, string(params.ProjectID), string(params.ID), update)
	if err != nil {
		return nil, err
	}
	return toAPIWebhook(entity), nil
}

func (h *Handler) DeleteWebhook(ctx context.Context, params api.DeleteWebhookParams) (api.DeleteWebhookRes, error) {
	if err := h.requireWebhookAccess(ctx, params.ProjectID, opDelete); err != nil {
		return nil, err
	}
	if err := h.webhookService.Delete(ctx, string(params.ProjectID), string(params.ID)); err != nil {
		return nil, err
	}
	return &api.DeleteWebhookNoContent{}, nil
}

func (h *Handler) RotateWebhookSecret(ctx context.Context, params api.RotateWebhookSecretParams) (api.RotateWebhookSecretRes, error) {
	if err := h.requireWebhookAccess(ctx, params.ProjectID, opWrite); err != nil {
		return nil, err
	}
	entity, secret, err := h.webhookService.RotateSecret(ctx, string(params.ProjectID), string(params.ID))
	if err != nil {
		return nil, err
	}
	return toAPIWebhookWithSecret(entity, secret), nil
}

// fromAPIWebhookEventTypes keeps nil as nil: an update that leaves
// event_types out must not read as one that empties it.
func fromAPIWebhookEventTypes(eventTypes api.WebhookEventTypes) []string {
	if eventTypes == nil {
		return nil
	}
	out := make([]string, len(eventTypes))
	for i, eventType := range eventTypes {
		out[i] = string(eventType)
	}
	return out
}

// toAPIWebhook leaves the stored secrets and the delivery cursor behind:
// neither is on the wire.
func toAPIWebhook(entity *domain.Webhook) *api.Webhook {
	eventTypes := make(api.WebhookEventTypes, len(entity.EventTypes))
	for i, eventType := range entity.EventTypes {
		eventTypes[i] = api.WebhookEventType(eventType)
	}
	out := &api.Webhook{
		ID:                      api.WebhookID(entity.ID),
		ProjectID:               api.ProjectID(entity.ProjectID),
		URL:                     api.WebhookURL(entity.URL),
		Description:             entity.Description,
		EventTypes:              eventTypes,
		Enabled:                 entity.Enabled,
		LastDeliveredAt:         toAPINilDateTime(entity.LastDeliveredAt),
		LastErrorStatus:         api.NilInt32{Null: true},
		LastErrorAt:             toAPINilDateTime(entity.LastErrorAt),
		PreviousSecretExpiresAt: toAPINilDateTime(entity.PreviousSecretExpiresAt),
		CreatedAt:               entity.CreatedAt,
	}
	if entity.LastErrorStatus != nil {
		out.LastErrorStatus = api.NewNilInt32(*entity.LastErrorStatus)
	}
	return out
}

// toAPINilDateTime writes the time, or an explicit null.
func toAPINilDateTime(at *time.Time) api.NilDateTime {
	if at == nil {
		return api.NilDateTime{Null: true}
	}
	return api.NewNilDateTime(*at)
}

// toAPIWebhookWithSecret adds the secret in clear, which only the responses
// to create and rotate carry.
func toAPIWebhookWithSecret(entity *domain.Webhook, secret string) *api.WebhookWithSecret {
	w := toAPIWebhook(entity)
	return &api.WebhookWithSecret{
		ID:                      w.ID,
		ProjectID:               w.ProjectID,
		URL:                     w.URL,
		Description:             w.Description,
		EventTypes:              w.EventTypes,
		Enabled:                 w.Enabled,
		LastDeliveredAt:         w.LastDeliveredAt,
		LastErrorStatus:         w.LastErrorStatus,
		LastErrorAt:             w.LastErrorAt,
		PreviousSecretExpiresAt: w.PreviousSecretExpiresAt,
		CreatedAt:               w.CreatedAt,
		Secret:                  secret,
	}
}

func webhookErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrWebhookInvalid().Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	case domain.ErrWebhookNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case domain.ErrWebhookPermissionDenied().Code:
		return errorResponseWithStatusCode(http.StatusForbidden, err)
	case domain.ErrWebhookLimitReached().Code:
		return errorResponseWithStatusCode(http.StatusConflict, err)
	default:
		return internalErrorResponse(err)
	}
}
