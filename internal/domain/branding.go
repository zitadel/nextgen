package domain

import (
	"context"
	"time"

	"github.com/zitadel/nextgen/internal/storage/database"
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

// NewBranding builds a new revision, defaulting the layout, and validates it
// with the lexical gate in branding_validator.go.
func NewBranding(projectID string, layout, liquidTemplate, logoURL, fontURL, heroURL string) (*Branding, error) {
	if projectID == "" {
		return nil, ErrBrandingMissingProjectID()
	}
	id, err := newID(PrefixBranding)
	if err != nil {
		return nil, ErrInternal(err).WithMessage("failed to generate branding id")
	}
	if layout == "" {
		layout = BrandingLayoutCentered
	}
	b := &Branding{
		ProjectID:      projectID,
		ID:             id,
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

//go:generate go tool mockgen -typed -package domainmock -destination ./mock/branding.mock.go . BrandingRepository

// BrandingRepository stores immutable branding revisions. There is no update
// or delete: publishing is the only write, mirroring JSON schemas.
type BrandingRepository interface {
	Repository

	brandingColumns
	brandingConditions

	Create(ctx context.Context, client database.QueryExecutor, branding *Branding) error
	GetByID(ctx context.Context, client database.QueryExecutor, projectID, id string) (*Branding, error)
	// GetLatest returns the newest revision for the project, or
	// database.NoRowFoundError when the project has none.
	GetLatest(ctx context.Context, client database.QueryExecutor, projectID string) (*Branding, error)
	List(ctx context.Context, client database.QueryExecutor, opts ...database.QueryOption) ([]*Branding, error)
}

type brandingColumns interface {
	ProjectID() database.Column
	ID() database.Column
	CreatedAt() database.Column
	Definition() database.Column
}

type brandingConditions interface {
	PrimaryKeyCondition(projectID, id string) database.Condition
	ProjectIDCondition(projectID string) database.Condition
}
