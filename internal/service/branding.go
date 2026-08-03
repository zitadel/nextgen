package service

import (
	"context"
	"errors"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/v2/branding"
	"github.com/zitadel/nextgen/internal/storage/v2/database"
)

// ---- Input types -------------------------------------------------------------

type CreateBrandingInput struct {
	ProjectID      string
	Layout         string
	LiquidTemplate string
	LogoURL        string
	FontURL        string
	HeroURL        string
}

// BrandingService publishes and resolves immutable branding revisions
// (ADR 040). Revisions are create-only; flow responses resolve the latest
// revision per project.
type BrandingService struct {
	v2Pool *DB
}

func NewBrandingService(v2Pool *DB) *BrandingService {
	return &BrandingService{
		v2Pool: v2Pool,
	}
}

// Create validates and publishes a new branding revision.
func (s *BrandingService) Create(ctx context.Context, input CreateBrandingInput) (*domain.Branding, error) {
	entity, err := domain.NewBranding(
		input.ProjectID,
		input.Layout,
		input.LiquidTemplate,
		input.LogoURL,
		input.FontURL,
		input.HeroURL,
	)
	if err != nil {
		return nil, err
	}
	if err := s.v2Pool.Statements().CreateBranding(ctx, entity); err != nil {
		// The only integrity constraint reachable from user input is the FK to
		// projects (the ULID primary key cannot realistically collide), so a
		// violation means the referenced project does not exist.
		if _, ok := errors.AsType[*database.IntegrityViolationError](err); ok {
			return nil, domain.ErrBrandingInvalid("project does not exist", err)
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to create branding revision in database")
	}
	return entity, nil
}

// Get returns a single revision by id.
func (s *BrandingService) Get(ctx context.Context, projectID, id string) (*domain.Branding, error) {
	entity, err := s.v2Pool.Statements().GetBrandingByID(ctx, projectID, id)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrBrandingNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get branding revision from database")
	}
	return entity, nil
}

// GetLatest returns the newest revision for the project, or nil (no error)
// when the project has none — callers fall back to built-in defaults.
func (s *BrandingService) GetLatest(ctx context.Context, projectID string) (*domain.Branding, error) {
	result, err := s.v2Pool.Statements().ListBrandings(ctx, branding.ListOptions(projectID, 1))
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to resolve latest branding revision")
	}
	if len(result.Items) == 0 {
		return nil, nil
	}
	return result.Items[0], nil
}

// maxBrandingListRevisions caps the list response: revisions accumulate
// forever by design, so an unbounded fetch would grow without limit. The cap
// generously covers the audit/rollback use case; full history querying
// arrives with ADR 031's list-endpoint query language.
const maxBrandingListRevisions = 100

// List returns the newest revisions for the project, newest first, capped at
// maxBrandingListRevisions.
func (s *BrandingService) List(ctx context.Context, projectID string) ([]*domain.Branding, error) {
	result, err := s.v2Pool.Statements().ListBrandings(ctx, branding.ListOptions(projectID, maxBrandingListRevisions))
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to list branding revisions")
	}
	return result.Items, nil
}
