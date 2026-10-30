package service

import (
	"context"
	"errors"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/branding"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// ---- Input types -------------------------------------------------------------

type CreateBrandingInput struct {
	ProjectID      string
	Layout         string
	LiquidTemplate string
	LogoURL        string
	HeroURL        string
	Theme          domain.BrandingTheme
	Typography     domain.BrandingTypography
	Shape          domain.BrandingShape
}

// BrandingService publishes and resolves immutable branding revisions
// (ADR 040). Revisions are create-only. Flow responses resolve through
// [ResolveFlowBranding].
type BrandingService struct {
	v2Pool *DB
}

func NewBrandingService(v2Pool *DB) *BrandingService {
	return &BrandingService{
		v2Pool: v2Pool,
	}
}

// Create validates and publishes a new branding revision.
func (s *BrandingService) Create(ctx context.Context, input CreateBrandingInput) (_ *domain.Branding, err error) {
	ctx, end := startSpan(ctx, "BrandingService.Create")
	defer end(&err)

	entity, err := prepareBranding(input)
	if err != nil {
		return nil, err
	}
	if err := s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		return s.createBranding(ctx, tx.Statements(), entity)
	}); err != nil {
		// The only integrity constraint reachable from user input is the FK to
		// projects (the ULID primary key cannot realistically collide), so a
		// violation means the referenced project does not exist.
		if _, ok := errors.AsType[*database.IntegrityViolationError](err); ok {
			return nil, domain.ErrBrandingInvalid("project does not exist", err)
		}
		if de, ok := errors.AsType[domain.Error](err); ok {
			return nil, de
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to create branding revision in database")
	}
	return entity, nil
}

func prepareBranding(input CreateBrandingInput) (*domain.Branding, error) {
	return domain.NewBranding(
		input.ProjectID,
		input.Layout,
		input.LiquidTemplate,
		input.LogoURL,
		input.HeroURL,
		input.Theme,
		input.Typography,
		input.Shape,
	)
}

// createBranding inserts a prepared branding revision and emits its event on stmts.
func (s *BrandingService) createBranding(ctx context.Context, stmts AllStatements, entity *domain.Branding) error {
	if err := stmts.CreateBranding(ctx, entity); err != nil {
		return err
	}
	return audit.Emit(ctx, stmts, audit.EmitSpec{
		Type:       domain.EventTypeBrandingCreated,
		Category:   domain.EventCategoryAdmin,
		ProjectID:  entity.ProjectID,
		EntityType: "branding",
		EntityID:   entity.ID,
		Payload: domain.BrandingPayload{
			Layout:  entity.Layout,
			LogoURL: entity.LogoURL,
			FontURL: entity.Typography.FontURL,
			HeroURL: entity.HeroURL,
		},
	})
}

// resolveOrCreateBranding reuses any existing branding revision whose content
// matches (preferring the newest match), otherwise inserts the prepared revision.
func (s *BrandingService) resolveOrCreateBranding(
	ctx context.Context,
	stmts AllStatements,
	projectID string,
	prepared *domain.Branding,
) (*domain.Branding, error) {
	match, err := matchingBranding(ctx, stmts, projectID, prepared)
	if err != nil {
		return nil, err
	}
	if match != nil {
		return match, nil
	}
	if err := s.createBranding(ctx, stmts, prepared); err != nil {
		return nil, err
	}
	return prepared, nil
}

// matchingBranding returns the newest revision whose content equals want, or
// nil when none match. Scanning history lets Build reuse an older revision
// when the newest has diverged (A→B→A content-hash reuse).
func matchingBranding(ctx context.Context, stmts AllStatements, projectID string, want *domain.Branding) (*domain.Branding, error) {
	result, err := stmts.ListBrandings(WithAuthzListUnrestricted(ctx), branding.ListOptions(projectID, maxHistoricalRevisions))
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to list branding")
	}
	for _, item := range result.Items {
		if want.Equal(item) {
			return item, nil
		}
	}
	return nil, nil
}

func latestBranding(ctx context.Context, stmts AllStatements, projectID string) (*domain.Branding, error) {
	result, err := stmts.ListBrandings(WithAuthzListUnrestricted(ctx), branding.ListOptions(projectID, 1))
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to list branding")
	}
	if len(result.Items) == 0 {
		return nil, nil
	}
	return result.Items[0], nil
}

// Get returns a single revision by id.
func (s *BrandingService) Get(ctx context.Context, projectID, id string) (_ *domain.Branding, err error) {
	ctx, end := startSpan(ctx, "BrandingService.Get")
	defer end(&err)

	entity, err := s.v2Pool.Statements().GetBrandingByID(ctx, projectID, id)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrBrandingNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get branding revision from database")
	}
	return entity, nil
}

// flowBrandingReader is the branding lookup a flow response needs.
type flowBrandingReader interface {
	Get(ctx context.Context, projectID, id string) (*domain.Branding, error)
}

// ResolveFlowBranding returns the revision the request's release pins, or nil
// when it pins none. The caller serves the built-in default for a nil revision
// or a failed read.
func ResolveFlowBranding(ctx context.Context, reader flowBrandingReader, projectID string) (*domain.Branding, error) {
	pins, err := runtimePins(ctx, domain.ReleasePointerKindBranding)
	if err != nil {
		return nil, err
	}
	id, ok := pins[domain.ReleaseBrandingHandle]
	if !ok {
		return nil, nil
	}
	return reader.Get(ctx, projectID, id)
}

// maxBrandingListRevisions caps the list response: revisions accumulate
// forever by design, so an unbounded fetch would grow without limit. The cap
// generously covers the audit/rollback use case; full history querying
// arrives with ADR 031's list-endpoint query language.
const maxBrandingListRevisions = 100

// List returns the newest revisions for the project, newest first, capped at
// maxBrandingListRevisions.
func (s *BrandingService) List(ctx context.Context, projectID string) (_ []*domain.Branding, err error) {
	ctx, end := startSpan(ctx, "BrandingService.List")
	defer end(&err)

	result, err := s.v2Pool.Statements().ListBrandings(ctx, branding.ListOptions(projectID, maxBrandingListRevisions))
	if err != nil {
		return nil, mapListError(err, "failed to list branding revisions")
	}
	return result.Items, nil
}
