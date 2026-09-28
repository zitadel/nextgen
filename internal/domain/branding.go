package domain

import (
	"encoding/json"
	"time"
)

const PrefixBranding ResourcePrefix = "brnd"

func ErrBrandingNotFound() Error {
	return newError(PrefixBranding.ErrorCodePrefix("not_found"), "branding: not found", nil, nil)
}

func ErrBrandingInvalid(details any, parent error) Error {
	return newError(PrefixBranding.ErrorCodePrefix("invalid"), "branding: invalid", details, parent)
}

func ErrBrandingMissingProjectID() Error {
	return newError(PrefixBranding.ErrorCodePrefix("missing_project_id"), "branding: missing project id", nil, nil)
}

func ErrBrandingPermissionDenied() Error {
	return newError(PrefixBranding.ErrorCodePrefix("permission_denied"), "branding: requires an operator-grade token bound to the project (project.write or a branding.* scope)", nil, nil)
}

// Branding layout presets understood by the bundled login template. The wire
// enum is defined in api/openapi/components/flows/branding.yaml; richer
// designs are delivered as Liquid templates, not new enum values (ADR 040).
const (
	BrandingLayoutCentered = "centered"
	BrandingLayoutSplit    = "split"
)

// BrandingThemeMode selects which of the published sides may run. A side runs
// only if the revision publishes it: light and dark carry their own colours and
// their own mark, and neither derives from the other.
//
// A string rather than an integer enum, here and below: the value's canonical
// form is the string, both on the wire and in the definition column it is
// stored in, so an integer would only add a mapping with nothing behind it.
type BrandingThemeMode string

const (
	BrandingThemeLight BrandingThemeMode = "light"
	BrandingThemeDark  BrandingThemeMode = "dark"
	BrandingThemeAuto  BrandingThemeMode = "auto"
)

func (m BrandingThemeMode) IsValid() bool {
	switch m {
	case BrandingThemeLight, BrandingThemeDark, BrandingThemeAuto:
		return true
	}
	return false
}

// BrandingRadiusPreset is a named corner rounding. `full` is a pill; the rest
// are pixel steps the token bridge applies proportionally across the ramp.
type BrandingRadiusPreset string

const (
	BrandingRadiusNone BrandingRadiusPreset = "none"
	BrandingRadiusSm   BrandingRadiusPreset = "sm"
	BrandingRadiusMd   BrandingRadiusPreset = "md"
	BrandingRadiusLg   BrandingRadiusPreset = "lg"
	BrandingRadiusFull BrandingRadiusPreset = "full"
)

func (p BrandingRadiusPreset) IsValid() bool {
	switch p {
	case BrandingRadiusNone, BrandingRadiusSm, BrandingRadiusMd, BrandingRadiusLg, BrandingRadiusFull:
		return true
	}
	return false
}

// BrandingDensity tunes spacing and control height.
type BrandingDensity string

const (
	BrandingDensityCompact     BrandingDensity = "compact"
	BrandingDensityRegular     BrandingDensity = "regular"
	BrandingDensityComfortable BrandingDensity = "comfortable"
)

func (d BrandingDensity) IsValid() bool {
	switch d {
	case BrandingDensityCompact, BrandingDensityRegular, BrandingDensityComfortable:
		return true
	}
	return false
}

// Bounds for the numeric appearance knobs. ogen enforces the same ranges from
// the OpenAPI contract; this gate re-checks them because a revision can also
// be built in-process.
const MaxBrandingRadiusPixels int = 32

const (
	MinBrandingScale     float64 = 0.75
	MaxBrandingScale     float64 = 1.25
	MinBrandingLogoScale float64 = 0.5
	MaxBrandingLogoScale float64 = 2
)

// Branding is one immutable branding revision for a project. Revisions are
// never updated or deleted; every edit publishes a new revision and flow
// responses resolve the newest one per project (ADR 040).
type Branding struct {
	ProjectID      string
	ID             string
	Layout         string
	LiquidTemplate string
	LogoURL        string
	HeroURL        string
	Theme          BrandingTheme
	Typography     BrandingTypography
	Shape          BrandingShape
	CreatedAt      time.Time
}

// BrandingTheme names the sides a revision publishes. An absent side is never
// resolved, whatever Mode or the viewer's operating system asks for.
type BrandingTheme struct {
	Mode  BrandingThemeMode  `json:"mode,omitempty"`
	Light *BrandingThemeSide `json:"light,omitempty"`
	Dark  *BrandingThemeSide `json:"dark,omitempty"`
}

// BrandingThemeSide is one complete surface. A key left unset here takes the
// maintained default for this side, never the other side's value.
type BrandingThemeSide struct {
	LogoURL string           `json:"logo_url,omitempty"`
	Palette *BrandingPalette `json:"palette,omitempty"`
}

// BrandingPalette is the semantic colour vocabulary a project writes against.
// Keys name roles rather than tokens, which is what lets the internal --zl-*
// names move without breaking a stored revision.
type BrandingPalette struct {
	Primary    string `json:"primary,omitempty"`
	OnPrimary  string `json:"on_primary,omitempty"`
	Background string `json:"background,omitempty"`
	Surface    string `json:"surface,omitempty"`
	Muted      string `json:"muted,omitempty"`
	Border     string `json:"border,omitempty"`
	Text       string `json:"text,omitempty"`
	TextMuted  string `json:"text_muted,omitempty"`
	Link       string `json:"link,omitempty"`
	Success    string `json:"success,omitempty"`
	Warning    string `json:"warning,omitempty"`
	Error      string `json:"error,omitempty"`
}

// BrandingTypography is the one face the surface renders in, body and headings
// alike. FontFamily names it and FontURL loads it, which is why the two sit
// together: either alone renders nothing the other would have.
type BrandingTypography struct {
	FontFamily string  `json:"font_family,omitempty"`
	FontURL    string  `json:"font_url,omitempty"`
	Scale      float64 `json:"scale,omitzero"`
}

// BrandingShape is shared across theme sides — a brand does not round its
// corners differently in the dark.
type BrandingShape struct {
	Radius    BrandingRadius  `json:"radius,omitzero"`
	Density   BrandingDensity `json:"density,omitempty"`
	LogoScale float64         `json:"logo_scale,omitzero"`
}

// BrandingRadius is a corner rounding expressed either as a preset name or as
// a pixel value. Brands routinely specify a number the five presets cannot
// express, so both spellings persist; the zero value leaves the maintained
// default in place.
type BrandingRadius struct {
	Preset BrandingRadiusPreset
	Pixels *int
}

func (r BrandingRadius) IsZero() bool {
	return r.Preset == "" && r.Pixels == nil
}

// MarshalJSON writes the radius the way the wire carries it: a bare string for
// a preset, a bare number for pixels.
func (r BrandingRadius) MarshalJSON() ([]byte, error) {
	if r.Pixels != nil {
		return json.Marshal(*r.Pixels)
	}
	return json.Marshal(r.Preset)
}

func (r *BrandingRadius) UnmarshalJSON(data []byte) error {
	var preset BrandingRadiusPreset
	if err := json.Unmarshal(data, &preset); err == nil {
		*r = BrandingRadius{Preset: preset}
		return nil
	}
	var pixels int
	if err := json.Unmarshal(data, &pixels); err != nil {
		return err
	}
	*r = BrandingRadius{Pixels: &pixels}
	return nil
}

// BrandingField enumerates the fields of Branding which can be used for
// filtering and ordering in list operations.
type BrandingField uint8

const (
	BrandingFieldUnspecified BrandingField = iota
	BrandingFieldProjectID
	BrandingFieldID
	BrandingFieldCreatedAt
)

// NewBranding builds a new revision, defaulting the layout, and validates it
// with the gate in branding_validator.go.
func NewBranding(
	projectID string,
	layout string,
	liquidTemplate string,
	logoURL string,
	heroURL string,
	theme BrandingTheme,
	typography BrandingTypography,
	shape BrandingShape,
) (*Branding, error) {
	if projectID == "" {
		return nil, ErrBrandingMissingProjectID()
	}
	if layout == "" {
		layout = BrandingLayoutCentered
	}
	b := &Branding{
		ProjectID:      projectID,
		Layout:         layout,
		LiquidTemplate: liquidTemplate,
		LogoURL:        logoURL,
		HeroURL:        heroURL,
		Theme:          theme,
		Typography:     typography,
		Shape:          shape,
		CreatedAt:      time.Now().UTC(),
	}
	if err := ValidateBranding(b); err != nil {
		return nil, err
	}
	return b, nil
}
