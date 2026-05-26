package service

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/domain/idgen"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// ProjectService is the project use-case surface.
type ProjectService interface {
	// Create generates a new project with server-minted secrets and persists it.
	// Returns the stored project including timestamps.
	Create(ctx context.Context, previewOrigins []string) (*domain.Project, error)

	// Get retrieves a project by ID.
	// Returns [database.NoRowFoundError] when no project with the given ID exists.
	Get(ctx context.Context, id string) (*domain.Project, error)
}

// NewProjectService returns a [ProjectService] backed by the given repository.
func NewProjectService(pool database.Pool, repo domain.ProjectRepository, ids idgen.Generator) ProjectService {
	return &projectService{pool: pool, repo: repo, ids: ids}
}

type projectService struct {
	pool database.Pool
	repo domain.ProjectRepository
	ids  idgen.Generator
}

var _ ProjectService = (*projectService)(nil)

func (s *projectService) Create(ctx context.Context, previewOrigins []string) (*domain.Project, error) {
	id, err := s.ids.New("proj")
	if err != nil {
		return nil, err
	}
	projectSecret, err := s.ids.New("sk_proj")
	if err != nil {
		return nil, err
	}
	previewSecret, err := s.ids.New("sk_proj")
	if err != nil {
		return nil, err
	}

	if previewOrigins == nil {
		previewOrigins = []string{}
	}

	project := &domain.Project{
		ID:             id,
		ProjectSecret:  projectSecret,
		PreviewSecret:  previewSecret,
		PreviewOrigins: previewOrigins,
	}
	if err := s.repo.Create(ctx, s.pool, project); err != nil {
		return nil, err
	}
	return s.repo.Get(ctx, s.pool, id)
}

func (s *projectService) Get(ctx context.Context, id string) (*domain.Project, error) {
	return s.repo.Get(ctx, s.pool, id)
}
