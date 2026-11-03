package api

import (
	"context"
	"net/url"

	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// WithConsentService wires the consent me endpoints (ADR 082 §8). A chainable
// setter like WithPolicyService, so NewHandler's call sites stay unchanged;
// without it the endpoints answer an internal error.
func (h *Handler) WithConsentService(s service.ConsentService) *Handler {
	h.consentService = s
	return h
}

// ListMyConsents serves the apps the signed-in user let act for them, on the
// session alone.
func (h *Handler) ListMyConsents(ctx context.Context, params api.ListMyConsentsParams) (api.ListMyConsentsRes, error) {
	self, err := requireSelf(ctx, params.ProjectID)
	if err != nil {
		return nil, err
	}
	if h.consentService == nil {
		return nil, domain.ErrInternal(nil).WithMessage("consents are not wired")
	}
	consents, nextPage, err := h.consentService.List(ctx, service.ListConsentsInput{
		ProjectID: self.ProjectID(),
		UserID:    self.UserID(),
		PageToken: string(params.PageToken.Value),
		Limit:     int(params.Limit.Value),
	})
	if err != nil {
		return nil, err
	}
	res := api.ListMyConsentsResponse{Consents: make([]api.ConsentResponse, len(consents))}
	if nextPage != "" {
		res.NextPageToken = api.NewOptNilPageToken(api.PageToken(nextPage))
	}
	for i, consent := range consents {
		resource, err := url.Parse(consent.Resource)
		if err != nil {
			return nil, domain.ErrInternal(err).WithMessage("a stored consent names a resource that is not a URL")
		}
		res.Consents[i] = api.ConsentResponse{
			ID:         api.ConsentID(consent.ID),
			ClientID:   consent.ClientID,
			ClientName: consent.ClientName,
			Resource:   *resource,
			Scopes:     consent.Scope,
			CreatedAt:  consent.CreatedAt,
			ExpiresAt:  consent.ExpiresAt,
		}
	}
	return &api.ListMyConsentsResponseHeaders{
		CacheControl: api.NewOptString(sessionStateCacheControl),
		Response:     res,
	}, nil
}

// RevokeMyConsent revokes one of the signed-in user's consents, and every
// token the client holds under it.
func (h *Handler) RevokeMyConsent(ctx context.Context, params api.RevokeMyConsentParams) (api.RevokeMyConsentRes, error) {
	self, err := requireSelf(ctx, params.ProjectID)
	if err != nil {
		return nil, err
	}
	if h.consentService == nil {
		return nil, domain.ErrInternal(nil).WithMessage("consents are not wired")
	}
	if err := h.consentService.Revoke(ctx, self.ProjectID(), self.UserID(), string(params.ConsentID)); err != nil {
		return nil, err
	}
	return &api.RevokeMyConsentNoContent{}, nil
}
