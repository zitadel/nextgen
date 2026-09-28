package service

import (
	"context"
	"errors"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
)

// ---- Input / output types ---------------------------------------------------

type ListEnvironmentsInput struct {
	ProjectID string
	PageToken string
	Limit     int
}

type ListEnvironmentsOutput struct {
	Items         []*domain.Environment
	NextPageToken string
}

type EnvironmentService struct {
	v2Pool *DB
}

func NewEnvironmentService(v2Pool *DB) *EnvironmentService {
	return &EnvironmentService{v2Pool: v2Pool}
}

// SeedDefaults creates domain.DefaultEnvironmentNames for the project, in
// order, on the statements of an already open transaction.
//
// It takes stmts rather than opening its own transaction because project
// creation seeds environments inside the transaction that creates the project:
// a project that committed without its runtime slots would be a project
// nothing can ever be deployed to, and no later code path would repair it.
func (s *EnvironmentService) SeedDefaults(ctx context.Context, stmts AllStatements, projectID string) error {
	return seedDefaultEnvironments(ctx, stmts, projectID)
}

func seedDefaultEnvironments(ctx context.Context, stmts AllStatements, projectID string) error {
	for _, name := range domain.DefaultEnvironmentNames {
		entity, err := domain.NewEnvironment(projectID, name)
		if err != nil {
			// A malformed constant is a programming error, not user input.
			return domain.ErrInternal(err).WithMessage("default environment name is invalid")
		}
		if err := stmts.CreateEnvironment(ctx, entity); err != nil {
			return domain.ErrInternal(err).WithMessage("failed to seed default environment")
		}
		if err := emitEnvironmentCreated(ctx, stmts, entity); err != nil {
			return err
		}
	}
	return nil
}

func emitEnvironmentCreated(ctx context.Context, stmts EventStatements, entity *domain.Environment) error {
	return audit.Emit(ctx, stmts, audit.EmitSpec{
		Type:       domain.EventTypeEnvironmentCreated,
		Category:   domain.EventCategoryAdmin,
		ProjectID:  entity.ProjectID,
		EntityType: "environment",
		EntityID:   entity.ID,
		Payload:    domain.EnvironmentPayload{Name: entity.Name},
	})
}

func (s *EnvironmentService) GetByName(ctx context.Context, projectID, name string) (*domain.Environment, error) {
	validated, err := domain.ValidateEnvironmentName(name)
	if err != nil {
		return nil, domain.ErrEnvironmentNotFound()
	}
	entity, err := s.v2Pool.Statements().GetEnvironmentByName(ctx, projectID, validated)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrEnvironmentNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get environment from database")
	}
	return entity, nil
}

func (s *EnvironmentService) List(ctx context.Context, input ListEnvironmentsInput) (*ListEnvironmentsOutput, error) {
	opts := &database.ListOptions[domain.EnvironmentField]{
		Filter: database.Equal(database.Col(domain.EnvironmentFieldProjectID), input.ProjectID),
		Pagination: database.Page[domain.EnvironmentField]{
			Limit:  uint32(normalizeLimit(input.Limit)),
			Cursor: []byte(input.PageToken),
			OrderBy: database.OrderBy[domain.EnvironmentField]{
				Columns: []database.Column[domain.EnvironmentField]{
					database.Col(domain.EnvironmentFieldName),
				},
				Direction: database.OrderAsc,
			},
		},
	}

	result, err := s.v2Pool.Statements().ListEnvironments(ctx, opts)
	if err != nil {
		return nil, mapListError(err, "failed to list environments")
	}

	return &ListEnvironmentsOutput{
		Items:         result.Items,
		NextPageToken: string(result.NextCursor),
	}, nil
}
