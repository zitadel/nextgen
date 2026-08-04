package domain

import (
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

// Branding is one immutable branding revision for a project. Revisions are
// never updated or deleted; every edit publishes a new revision and flow
// responses resolve the newest one per project (ADR 040).
type Branding struct {
	ProjectID      string
	ID             string
	Layout         string
	LiquidTemplate string
	LogoURL        string
	FontURL        string
	HeroURL        string
	CreatedAt      time.Time
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
// with the lexical gate in branding_validator.go.
func NewBranding(projectID string, layout, liquidTemplate, logoURL, fontURL, heroURL string) (*Branding, error) {
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
		FontURL:        fontURL,
		HeroURL:        heroURL,
		CreatedAt:      time.Now().UTC(),
	}
	if err := ValidateBranding(b); err != nil {
		return nil, err
	}
	return b, nil
}
