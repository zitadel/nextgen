package api

import (
	"context"
	"net/http"
	"net/url"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Handler) CreateBranding(ctx context.Context, req *api.Branding, params api.CreateBrandingParams) (api.CreateBrandingRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), brandingAccess, opWrite); err != nil {
		return nil, err
	}
	branding, err := h.brandingService.Create(ctx, service.CreateBrandingInput{
		ProjectID:      string(params.ProjectID),
		Layout:         string(req.Layout.Value),
		LiquidTemplate: req.LiquidTemplate.Value,
		LogoURL:        optURIString(req.LogoURL),
		FontURL:        optURIString(req.FontURL),
		HeroURL:        optURIString(req.HeroURL),
	})
	if err != nil {
		return nil, err
	}
	return brandingRevisionResponse(branding), nil
}

func (h *Handler) GetBrandingById(ctx context.Context, params api.GetBrandingByIdParams) (api.GetBrandingByIdRes, error) {
	projectID, err := h.requireResourceAccess(ctx, params.ID, brandingAccess, opRead)
	if err != nil {
		return nil, err
	}
	branding, err := h.brandingService.Get(ctx, projectID, params.ID)
	if err != nil {
		return nil, err
	}
	return brandingRevisionResponse(branding), nil
}

func (h *Handler) ListBranding(ctx context.Context, params api.ListBrandingParams) (api.ListBrandingRes, error) {
	proceed, err := h.requireProjectListAccess(ctx, string(params.ProjectID), brandingAccess)
	if err != nil || !proceed {
		return nil, err
	}
	ctx, err = h.withAuthzListFilter(ctx, string(params.ProjectID), domain.ResourceKindBranding, opRead)
	if err != nil {
		return nil, err
	}
	brandings, err := h.brandingService.List(ctx, string(params.ProjectID))
	if err != nil {
		return nil, err
	}
	resp := make(api.ListBrandingResponse, 0, len(brandings))
	for _, b := range brandings {
		resp = append(resp, api.ListBrandingResponseItem{
			ID:        b.ID,
			CreatedAt: b.CreatedAt,
		})
	}
	return &resp, nil
}

// resolveBranding resolves the branding a flow response should carry: the
// latest stored revision for the project, or the built-in default (ADR 040).
// Resolution failures degrade to the default on purpose — a broken branding
// lookup must never take the login down.
func (h *Handler) resolveBranding(ctx context.Context, projectID string) api.Branding {
	if h.brandingService == nil || projectID == "" {
		return defaultBranding()
	}
	branding, err := h.brandingService.GetLatest(ctx, projectID)
	if err != nil {
		// Deliberate degrade, but never a silent one: without this line a
		// flaky lookup presents as "my branding intermittently disappears"
		// with nothing to grep for.
		zlog.GetLoggingContext(ctx).Warn(
			"branding resolution failed; serving default branding",
			"project_id", projectID,
			"err", err,
		)
		return defaultBranding()
	}
	if branding == nil {
		return defaultBranding()
	}
	return toAPIBranding(branding)
}

// defaultBranding is the fallback when a project has no stored branding
// revision. The default login template is not sent from the server: it is
// bundled with @zitadel/components, and the orchestrator falls back to it
// whenever branding carries no liquid_template.
func defaultBranding() api.Branding {
	return api.Branding{
		Layout: api.NewOptBrandingLayout(api.BrandingLayoutCentered),
	}
}

/* ---------------- CONVERTERS ---------------- */

func brandingRevisionResponse(b *domain.Branding) *api.BrandingRevisionResponse {
	return &api.BrandingRevisionResponse{
		ID:        b.ID,
		CreatedAt: b.CreatedAt,
		Branding:  toAPIBranding(b),
	}
}

func toAPIBranding(b *domain.Branding) api.Branding {
	out := api.Branding{
		Layout: api.NewOptBrandingLayout(api.BrandingLayout(b.Layout)),
	}
	if b.LiquidTemplate != "" {
		out.LiquidTemplate = api.NewOptString(b.LiquidTemplate)
	}
	if u, err := url.Parse(b.LogoURL); err == nil && b.LogoURL != "" {
		out.LogoURL = api.NewOptURI(*u)
	}
	if u, err := url.Parse(b.FontURL); err == nil && b.FontURL != "" {
		out.FontURL = api.NewOptURI(*u)
	}
	if u, err := url.Parse(b.HeroURL); err == nil && b.HeroURL != "" {
		out.HeroURL = api.NewOptURI(*u)
	}
	return out
}

func optURIString(u api.OptURI) string {
	if !u.Set {
		return ""
	}
	return u.Value.String()
}

func brandingErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrBrandingNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case domain.ErrBrandingInvalid(nil, nil).Code, domain.ErrBrandingMissingProjectID().Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	case domain.ErrBrandingPermissionDenied().Code:
		return errorResponseWithStatusCode(http.StatusForbidden, err)
	default:
		return internalErrorResponse(err)
	}
}
