package service

import (
	"context"
	"errors"
	"time"

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

// UpsertPreviewEnvironmentInput creates a preview environment or renews one
// that already exists under the same name.
type UpsertPreviewEnvironmentInput struct {
	ProjectID string
	Name      string
	// TTL is how long the preview lives from now. Renewed on every upsert.
	TTL time.Duration
	// Origins are the request origins this preview serves. Replaced on renew.
	Origins []string
}

type UpsertPreviewEnvironmentOutput struct {
	Environment *domain.Environment
	Created     bool
}

// DefaultPreviewTTL applies when a preview is created without a ttl.
const DefaultPreviewTTL = 7 * 24 * time.Hour

// MaxPreviewTTL caps how far out a preview may be renewed.
const MaxPreviewTTL = 30 * 24 * time.Hour

type EnvironmentService struct {
	v2Pool *DB
	now    func() time.Time
}

func NewEnvironmentService(v2Pool *DB) *EnvironmentService {
	return &EnvironmentService{v2Pool: v2Pool, now: time.Now}
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
		Payload:    domain.EnvironmentPayload{Name: entity.Name, Class: entity.Class.String()},
	})
}

// SetLiveOrigins replaces the origins of the live environment: the fixed
// origins production is served from (`zitadel deploy` takes them from the
// production entry's issuer in zitadel.json). An origin named here
// literally is served by live even when a preview's wildcard also covers it.
func (s *EnvironmentService) SetLiveOrigins(ctx context.Context, projectID string, origins []string) (*domain.Environment, error) {
	normalized, err := domain.ValidateEnvironmentOrigins(origins)
	if err != nil {
		return nil, err
	}
	live, err := s.GetByName(ctx, projectID, domain.LiveEnvironmentName)
	if err != nil {
		return nil, err
	}
	live.Origins = normalized
	if err := s.v2Pool.Statements().RenewEnvironment(ctx, live); err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrEnvironmentNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to update the live environment's origins")
	}
	return live, nil
}

// UpsertPreview creates the named preview environment, or renews its expiry
// and replaces its origins when it already exists. `zitadel preview` calls it
// before every deployment to a preview, so a preview that is still being
// used never expires under the developer.
func (s *EnvironmentService) UpsertPreview(ctx context.Context, input UpsertPreviewEnvironmentInput) (*UpsertPreviewEnvironmentOutput, error) {
	ttl := input.TTL
	if ttl <= 0 {
		ttl = DefaultPreviewTTL
	}
	if ttl > MaxPreviewTTL {
		return nil, domain.ErrEnvironmentInvalid("ttl exceeds the maximum of 30 days")
	}
	expiresAt := s.now().UTC().Add(ttl)
	entity, err := domain.NewPreviewEnvironment(input.ProjectID, input.Name, expiresAt, input.Origins)
	if err != nil {
		return nil, err
	}

	var created bool
	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		created = false
		existing, err := tx.Statements().GetEnvironmentByName(ctx, entity.ProjectID, entity.Name)
		if err != nil && !errors.Is(err, new(database.NoRowFoundError)) {
			return err
		}
		if existing != nil {
			if existing.Class != domain.EnvironmentClassPreview {
				return domain.ErrEnvironmentInvalid("only preview environments can be created or renewed")
			}
			existing.ExpiresAt = entity.ExpiresAt
			existing.Origins = entity.Origins
			if err := tx.Statements().RenewEnvironment(ctx, existing); err != nil {
				return err
			}
			*entity = *existing
			return nil
		}
		if err := tx.Statements().CreateEnvironment(ctx, entity); err != nil {
			return err
		}
		created = true
		return emitEnvironmentCreated(ctx, tx.Statements(), entity)
	})
	if err != nil {
		if de, ok := errors.AsType[domain.Error](err); ok {
			return nil, de
		}
		if _, ok := errors.AsType[*database.ForeignKeyError](err); ok {
			return nil, domain.ErrEnvironmentProjectNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to upsert preview environment")
	}
	return &UpsertPreviewEnvironmentOutput{Environment: entity, Created: created}, nil
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
