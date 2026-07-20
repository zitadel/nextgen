package service

import (
	"context"
	"errors"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
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
// (ADR 035). Revisions are create-only; flow responses resolve the latest
// revision per project.
type BrandingService struct {
	pool         database.Pool
	brandingRepo domain.BrandingRepository
}

func NewBrandingService(pool database.Pool, brandingRepo domain.BrandingRepository) *BrandingService {
	return &BrandingService{
		pool:         pool,
		brandingRepo: brandingRepo,
	}
}

// Create validates and publishes a new branding revision.
func (s *BrandingService) Create(ctx context.Context, input CreateBrandingInput) (*domain.Branding, error) {
	branding, err := domain.NewBranding(
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
	if err := s.brandingRepo.Create(ctx, s.pool, branding); err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to create branding revision in database")
	}
	return branding, nil
}

// Get returns a single revision by id.
func (s *BrandingService) Get(ctx context.Context, projectID, id string) (*domain.Branding, error) {
	branding, err := s.brandingRepo.GetByID(ctx, s.pool, projectID, id)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrBrandingNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get branding revision from database")
	}
	return branding, nil
}

// GetLatest returns the newest revision for the project, or nil (no error)
// when the project has none — callers fall back to built-in defaults.
func (s *BrandingService) GetLatest(ctx context.Context, projectID string) (*domain.Branding, error) {
	branding, err := s.brandingRepo.GetLatest(ctx, s.pool, projectID)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, nil
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to resolve latest branding revision")
	}
	return branding, nil
}

// List returns revisions for the project, newest first.
func (s *BrandingService) List(ctx context.Context, projectID string) ([]*domain.Branding, error) {
	brandings, err := s.brandingRepo.List(ctx, s.pool,
		database.WithCondition(s.brandingRepo.ProjectIDCondition(projectID)),
		database.WithOrderByDescending(s.brandingRepo.CreatedAt(), s.brandingRepo.ID()),
	)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to list branding revisions")
	}
	return brandings, nil
}
