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
		HeroURL:        optURIString(req.HeroURL),
		Theme:          brandingThemeFromAPI(req.Theme),
		Typography:     brandingTypographyFromAPI(req.Typography),
		Shape:          brandingShapeFromAPI(req.Shape),
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
	ctx, err := h.requireProjectListAccess(ctx, string(params.ProjectID), brandingAccess, domain.ResourceKindBranding)
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
	out.LogoURL = optURI(b.LogoURL)
	out.HeroURL = optURI(b.HeroURL)
	if theme, ok := toAPIBrandingTheme(b.Theme); ok {
		out.Theme = api.NewOptBrandingTheme(theme)
	}
	if typography, ok := toAPIBrandingTypography(b.Typography); ok {
		out.Typography = api.NewOptBrandingTypography(typography)
	}
	if shape, ok := toAPIBrandingShape(b.Shape); ok {
		out.Shape = api.NewOptBrandingShape(shape)
	}
	return out
}

func toAPIBrandingTheme(theme domain.BrandingTheme) (api.BrandingTheme, bool) {
	out := api.BrandingTheme{}
	if theme.Mode != "" {
		out.Mode = api.NewOptBrandingThemeMode(api.BrandingThemeMode(theme.Mode))
	}
	if side, ok := toAPIBrandingThemeSide(theme.Light); ok {
		out.Light = api.NewOptBrandingThemeSide(side)
	}
	if side, ok := toAPIBrandingThemeSide(theme.Dark); ok {
		out.Dark = api.NewOptBrandingThemeSide(side)
	}
	return out, out.Mode.Set || out.Light.Set || out.Dark.Set
}

// toAPIBrandingThemeSide keeps a published side visible even when every key on
// it is empty: which sides exist is what decides whether a theme may resolve to
// them, so an empty-but-published side is not the same as an absent one.
func toAPIBrandingThemeSide(side *domain.BrandingThemeSide) (api.BrandingThemeSide, bool) {
	if side == nil {
		return api.BrandingThemeSide{}, false
	}
	out := api.BrandingThemeSide{LogoURL: optURI(side.LogoURL)}
	if palette, ok := toAPIBrandingPalette(side.Palette); ok {
		out.Palette = api.NewOptBrandingPalette(palette)
	}
	return out, true
}

func toAPIBrandingPalette(palette *domain.BrandingPalette) (api.BrandingPalette, bool) {
	if palette == nil {
		return api.BrandingPalette{}, false
	}
	return api.BrandingPalette{
		Primary:    optBrandingColor(palette.Primary),
		OnPrimary:  optBrandingColor(palette.OnPrimary),
		Background: optBrandingColor(palette.Background),
		Surface:    optBrandingColor(palette.Surface),
		Muted:      optBrandingColor(palette.Muted),
		Border:     optBrandingColor(palette.Border),
		Text:       optBrandingColor(palette.Text),
		TextMuted:  optBrandingColor(palette.TextMuted),
		Link:       optBrandingColor(palette.Link),
		Success:    optBrandingColor(palette.Success),
		Warning:    optBrandingColor(palette.Warning),
		Error:      optBrandingColor(palette.Error),
	}, true
}

func toAPIBrandingTypography(typography domain.BrandingTypography) (api.BrandingTypography, bool) {
	out := api.BrandingTypography{
		FontFamily: optAPIString(typography.FontFamily),
		FontURL:    optURI(typography.FontURL),
	}
	if typography.Scale != 0 {
		out.Scale = api.NewOptFloat64(typography.Scale)
	}
	return out, out.FontFamily.Set || out.FontURL.Set || out.Scale.Set
}

func toAPIBrandingShape(shape domain.BrandingShape) (api.BrandingShape, bool) {
	out := api.BrandingShape{}
	switch {
	case shape.Radius.Pixels != nil:
		out.Radius = api.NewOptBrandingShapeRadius(api.NewIntBrandingShapeRadius(*shape.Radius.Pixels))
	case shape.Radius.Preset != "":
		out.Radius = api.NewOptBrandingShapeRadius(
			api.NewBrandingRadiusPresetBrandingShapeRadius(api.BrandingRadiusPreset(shape.Radius.Preset)))
	}
	if shape.Density != "" {
		out.Density = api.NewOptBrandingShapeDensity(api.BrandingShapeDensity(shape.Density))
	}
	if shape.LogoScale != 0 {
		out.LogoScale = api.NewOptFloat64(shape.LogoScale)
	}
	return out, out.Radius.Set || out.Density.Set || out.LogoScale.Set
}

func brandingThemeFromAPI(theme api.OptBrandingTheme) domain.BrandingTheme {
	if !theme.Set {
		return domain.BrandingTheme{}
	}
	return domain.BrandingTheme{
		Mode:  domain.BrandingThemeMode(theme.Value.Mode.Value),
		Light: brandingThemeSideFromAPI(theme.Value.Light),
		Dark:  brandingThemeSideFromAPI(theme.Value.Dark),
	}
}

func brandingThemeSideFromAPI(side api.OptBrandingThemeSide) *domain.BrandingThemeSide {
	if !side.Set {
		return nil
	}
	return &domain.BrandingThemeSide{
		LogoURL: optURIString(side.Value.LogoURL),
		Palette: brandingPaletteFromAPI(side.Value.Palette),
	}
}

func brandingPaletteFromAPI(palette api.OptBrandingPalette) *domain.BrandingPalette {
	if !palette.Set {
		return nil
	}
	return &domain.BrandingPalette{
		Primary:    string(palette.Value.Primary.Value),
		OnPrimary:  string(palette.Value.OnPrimary.Value),
		Background: string(palette.Value.Background.Value),
		Surface:    string(palette.Value.Surface.Value),
		Muted:      string(palette.Value.Muted.Value),
		Border:     string(palette.Value.Border.Value),
		Text:       string(palette.Value.Text.Value),
		TextMuted:  string(palette.Value.TextMuted.Value),
		Link:       string(palette.Value.Link.Value),
		Success:    string(palette.Value.Success.Value),
		Warning:    string(palette.Value.Warning.Value),
		Error:      string(palette.Value.Error.Value),
	}
}

func brandingTypographyFromAPI(typography api.OptBrandingTypography) domain.BrandingTypography {
	if !typography.Set {
		return domain.BrandingTypography{}
	}
	return domain.BrandingTypography{
		FontFamily: typography.Value.FontFamily.Value,
		FontURL:    optURIString(typography.Value.FontURL),
		Scale:      typography.Value.Scale.Value,
	}
}

func brandingShapeFromAPI(shape api.OptBrandingShape) domain.BrandingShape {
	if !shape.Set {
		return domain.BrandingShape{}
	}
	out := domain.BrandingShape{
		Density:   domain.BrandingDensity(shape.Value.Density.Value),
		LogoScale: shape.Value.LogoScale.Value,
	}
	if radius, ok := shape.Value.Radius.Get(); ok {
		if pixels, ok := radius.GetInt(); ok {
			out.Radius.Pixels = new(pixels)
		} else if preset, ok := radius.GetBrandingRadiusPreset(); ok {
			out.Radius.Preset = domain.BrandingRadiusPreset(preset)
		}
	}
	return out
}

func optURI(raw string) api.OptURI {
	if raw == "" {
		return api.OptURI{}
	}
	u, err := url.Parse(raw)
	if err != nil {
		return api.OptURI{}
	}
	return api.NewOptURI(*u)
}

func optBrandingColor(value string) api.OptBrandingColor {
	if value == "" {
		return api.OptBrandingColor{}
	}
	return api.NewOptBrandingColor(api.BrandingColor(value))
}

func optAPIString(value string) api.OptString {
	if value == "" {
		return api.OptString{}
	}
	return api.NewOptString(value)
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
