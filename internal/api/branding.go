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
	if err := requireBrandingAccess(ctx, params.ProjectID, true); err != nil {
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
	if err := requireBrandingAccess(ctx, params.ProjectID, false); err != nil {
		return nil, err
	}
	branding, err := h.brandingService.Get(ctx, string(params.ProjectID), params.ID)
	if err != nil {
		return nil, err
	}
	return brandingRevisionResponse(branding), nil
}

func (h *Handler) ListBranding(ctx context.Context, params api.ListBrandingParams) (api.ListBrandingRes, error) {
	if err := requireBrandingAccess(ctx, params.ProjectID, false); err != nil {
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

// requireBrandingAccess gates the branding management API: the bearer must be
// bound to the requested project and carry a management-grade scope. Managing
// templates and rendering them during login are different planes — the login
// path never calls this API (branding arrives inline on flow responses), so
// the browser-grade preview secret (project.read only, shipped to visitors'
// browsers by design) is excluded entirely.
func requireBrandingAccess(ctx context.Context, projectID api.ProjectID, write bool) error {
	scope, ok := GetScopeContext(ctx)
	if !ok || scope.ProjectID == "" || scope.ProjectID != string(projectID) {
		// Anti-oracle: a foreign project — existing or not — answers exactly
		// like a nonexistent one.
		if write {
			return domain.ErrBrandingInvalid("project does not exist", nil)
		}
		return domain.ErrBrandingNotFound()
	}
	if !brandingScopeAllowed(scope.Scope, write) {
		return domain.ErrBrandingPermissionDenied()
	}
	return nil
}

// brandingScopeAllowed maps today's minted scopes onto the management API:
// project.write is the operator-grade legacy scope every project secret
// carries and implies the finer branding.* scopes declared in the OpenAPI
// contract (which arrive as mintable scopes with ADR 036's credential
// planes). project.read alone — the preview secret — grants nothing here.
func brandingScopeAllowed(scopes []string, write bool) bool {
	for _, s := range scopes {
		switch s {
		case "project.write", "branding.write":
			return true
		case "branding.read":
			if !write {
				return true
			}
		}
	}
	return false
}

// resolveBranding resolves the branding a flow response should carry: the
// latest stored revision for the project, or the built-in default (ADR 037).
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
