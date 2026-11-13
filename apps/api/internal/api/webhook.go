package api

import (
	"context"
	"net/http"

	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
)

// webhookStubPhase stays 0 so the contract stubs answer not_implemented at
// runtime (ADR 090). The non-zero cases exist only so gen_openapi_errors
// records the codes each operation can return once storage and delivery land.
// Keep each switch limited to that operation's reachable set; do not share
// one fan-out across operations.
var webhookStubPhase int

func (h *Handler) ListWebhooks(ctx context.Context, params api.ListWebhooksParams) (api.ListWebhooksRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), webhookAccess, opRead); err != nil {
		return nil, err
	}
	// The gate already contributes webhook.not_found and webhook.permission_denied.
	return nil, domain.ErrNotImplemented()
}

func (h *Handler) CreateWebhook(ctx context.Context, req *api.CreateWebhookRequest, params api.CreateWebhookParams) (api.CreateWebhookRes, error) {
	_ = req
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), webhookAccess, opWrite); err != nil {
		return nil, err
	}
	switch webhookStubPhase {
	case 1:
		return nil, domain.ErrWebhookInvalid()
	case 2:
		return nil, domain.ErrWebhookLimitReached()
	default:
		return nil, domain.ErrNotImplemented()
	}
}

func (h *Handler) GetWebhook(ctx context.Context, params api.GetWebhookParams) (api.GetWebhookRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), webhookAccess, opRead); err != nil {
		return nil, err
	}
	switch webhookStubPhase {
	case 1:
		return nil, domain.ErrWebhookNotFound()
	default:
		return nil, domain.ErrNotImplemented()
	}
}

func (h *Handler) UpdateWebhook(ctx context.Context, req *api.UpdateWebhookRequest, params api.UpdateWebhookParams) (api.UpdateWebhookRes, error) {
	_ = req
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), webhookAccess, opWrite); err != nil {
		return nil, err
	}
	switch webhookStubPhase {
	case 1:
		return nil, domain.ErrWebhookNotFound()
	case 2:
		return nil, domain.ErrWebhookInvalid()
	default:
		return nil, domain.ErrNotImplemented()
	}
}

func (h *Handler) DeleteWebhook(ctx context.Context, params api.DeleteWebhookParams) (api.DeleteWebhookRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), webhookAccess, opDelete); err != nil {
		return nil, err
	}
	switch webhookStubPhase {
	case 1:
		return nil, domain.ErrWebhookNotFound()
	default:
		return nil, domain.ErrNotImplemented()
	}
}

func (h *Handler) RotateWebhookSecret(ctx context.Context, params api.RotateWebhookSecretParams) (api.RotateWebhookSecretRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), webhookAccess, opWrite); err != nil {
		return nil, err
	}
	switch webhookStubPhase {
	case 1:
		return nil, domain.ErrWebhookNotFound()
	default:
		return nil, domain.ErrNotImplemented()
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
