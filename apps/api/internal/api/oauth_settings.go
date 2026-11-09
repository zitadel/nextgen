package api

import (
	"context"
	"errors"
	"net/http"

	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// WithOAuthSettingsService wires the OAuth settings read endpoint. A
// chainable setter like WithPolicyService, so NewHandler's call sites stay
// unchanged; without it the endpoint answers an internal error.
func (h *Handler) WithOAuthSettingsService(s *service.OAuthSettingsService) *Handler {
	h.oauthSettingsService = s
	return h
}

func (h *Handler) GetOAuthSettingsById(ctx context.Context, params api.GetOAuthSettingsByIdParams) (api.GetOAuthSettingsByIdRes, error) {
	projectID, err := h.requireResourceAccess(ctx, params.OAuthSettingsID, oauthSettingsAccess, opRead)
	if err != nil {
		return nil, err
	}
	if h.oauthSettingsService == nil {
		return nil, domain.ErrInternal(errors.New("oauth settings service not configured"))
	}
	settings, err := h.oauthSettingsService.Get(ctx, projectID, params.OAuthSettingsID)
	if err != nil {
		return nil, err
	}
	return oauthSettingsRevisionResponse(settings), nil
}

func oauthSettingsRevisionResponse(s *domain.OAuthSettings) *api.OAuthSettingsRevisionResponse {
	return &api.OAuthSettingsRevisionResponse{
		ID:        s.ID,
		CreatedAt: s.CreatedAt,
		OAuth:     api.OAuthSettings{Enabled: s.Enabled},
	}
}

func oauthSettingsErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrOAuthSettingsNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case domain.ErrOAuthSettingsInvalid(nil, nil).Code, domain.ErrOAuthSettingsMissingProjectID().Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	case domain.ErrOAuthSettingsPermissionDenied().Code:
		return errorResponseWithStatusCode(http.StatusForbidden, err)
	default:
		return internalErrorResponse(err)
	}
}
