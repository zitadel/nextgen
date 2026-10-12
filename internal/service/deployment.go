package service

import (
	"context"
	"errors"
	"time"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/deployment"
)

// ---- Input / output types ---------------------------------------------------

// CreateDeploymentInput carries a resolved release id and exact target
// origins: the API edge resolves a content hash and expands `primary` before
// calling the service.
type CreateDeploymentInput struct {
	ProjectID  string
	ReleaseID  string
	TargetKind domain.DeploymentTargetKind
	Origins    []string
	Reason     domain.DeploymentReason
	// Message is the caller's summary of why this deployment happened.
	Message *string
	// RollbackTo names the deployment a rollback re-applies. Required with
	// reason rollback, rejected otherwise.
	RollbackTo *string
	// ExpectedDeploymentID makes the write conditional. Not persisted.
	ExpectedDeploymentID *string
	// PreviewTTL sets the expiry of the previews a deployment to preview URLs
	// creates or renews.
	PreviewTTL time.Duration
}

// CreateDeploymentOutput distinguishes a new deployment from the idempotent
// answer: deploying the release every target already serves returns the
// newest deployment to them, which the caller answers 200 to rather than 201.
type CreateDeploymentOutput struct {
	Deployment *domain.Deployment
	Created    bool
}

type ListDeploymentsInput struct {
	ProjectID string
	// Origin narrows the list to one origin's history. Nil lists the whole
	// project, every origin interleaved.
	Origin *string
	// IncludeReleases embeds the release each deployment made live (ADR 059).
	IncludeReleases bool
	PageToken       string
	Limit           int
}

type ListDeploymentsOutput struct {
	Items []*domain.Deployment
	// ReleasesByID holds the releases the listed deployments point at, keyed
	// by id, when IncludeReleases asked for them. Nil otherwise: the caller
	// distinguishes "did not ask" from "none found".
	ReleasesByID  map[string]*domain.Release
	NextPageToken string
}

type DeploymentService struct {
	v2Pool *DB
}

func NewDeploymentService(v2Pool *DB) *DeploymentService {
	return &DeploymentService{v2Pool: v2Pool}
}

// Create makes a release live on its targets by recording a deployment, with
// every target or not at all.
//
// Idempotent on what the targets serve: deploying the release every target
// already serves writes nothing and returns the newest deployment to them.
// Anything else appends — each row is one act of making a release live.
func (s *DeploymentService) Create(ctx context.Context, input CreateDeploymentInput) (*CreateDeploymentOutput, error) {
	actor, _ := audit.ActorFromContext(ctx)
	entity, err := domain.NewDeployment(input.ProjectID, input.ReleaseID, input.TargetKind, input.Origins, domain.DeploymentMetadata{
		Reason:         input.Reason,
		Message:        input.Message,
		RollbackTo:     input.RollbackTo,
		DeployedBy:     actor.ActorID,
		DeployedByType: actor.ActorType,
	})
	if err != nil {
		return nil, err
	}

	var created bool
	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		var err error
		created, err = tx.Statements().CreateDeployment(ctx, entity, input.ExpectedDeploymentID, input.PreviewTTL)
		if err != nil {
			return err
		}
		// The idempotent answer changed nothing, so there is nothing to
		// audit: the event of the deployment being returned was emitted when
		// it was created.
		if !created {
			return nil
		}
		return emitDeploymentCreated(ctx, tx.Statements(), entity)
	})
	if err != nil {
		// The project row is locked first, so a missing one surfaces here
		// rather than as a constraint violation.
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrProjectNotFound()
		}
		// The release reference is the one foreign key a caller can trip:
		// the project was already locked.
		if _, ok := errors.AsType[*database.ForeignKeyError](err); ok {
			return nil, domain.ErrDeploymentInvalid("release not found in this project", err)
		}
		if de, ok := errors.AsType[domain.Error](err); ok {
			return nil, de
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to create deployment")
	}
	return &CreateDeploymentOutput{Deployment: entity, Created: created}, nil
}

func emitDeploymentCreated(ctx context.Context, stmts EventStatements, entity *domain.Deployment) error {
	return audit.Emit(ctx, stmts, audit.EmitSpec{
		Type:       domain.EventTypeDeploymentCreated,
		Category:   domain.EventCategoryAdmin,
		ProjectID:  entity.ProjectID,
		EntityType: "deployment",
		EntityID:   entity.ID,
		Payload:    domain.DeploymentPayloadSnapshot(entity),
	})
}

func (s *DeploymentService) Get(ctx context.Context, projectID, id string) (*domain.Deployment, error) {
	entity, err := s.v2Pool.Statements().GetDeploymentByID(ctx, projectID, id)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrDeploymentNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get deployment from database")
	}
	return entity, nil
}

// GetByIDs reads the named deployments keyed by id. Ids nothing answers to
// are simply absent.
func (s *DeploymentService) GetByIDs(ctx context.Context, projectID string, ids []string) (map[string]*domain.Deployment, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	items, err := s.v2Pool.Statements().GetDeploymentsByIDs(ctx, projectID, ids)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to get deployments from database")
	}
	byID := make(map[string]*domain.Deployment, len(items))
	for _, entity := range items {
		byID[entity.ID] = entity
	}
	return byID, nil
}

func (s *DeploymentService) List(ctx context.Context, input ListDeploymentsInput) (*ListDeploymentsOutput, error) {
	opts := deployment.ListOptions(input.ProjectID, input.Origin, uint32(normalizeLimit(input.Limit)))
	opts.Pagination.Cursor = []byte(input.PageToken)

	result, err := s.v2Pool.Statements().ListDeployments(ctx, opts)
	if err != nil {
		return nil, mapListError(err, "failed to list deployments")
	}

	output := &ListDeploymentsOutput{
		Items:         result.Items,
		NextPageToken: string(result.NextCursor),
	}
	if input.IncludeReleases {
		releases, err := s.releasesFor(ctx, input.ProjectID, result.Items)
		if err != nil {
			return nil, err
		}
		output.ReleasesByID = releases
	}
	return output, nil
}

// releasesFor hydrates the releases a page of deployments points at, batched:
// one read for the page, deduplicated — a history is usually many deployments
// of few releases (ADR 059).
func (s *DeploymentService) releasesFor(ctx context.Context, projectID string, items []*domain.Deployment) (map[string]*domain.Release, error) {
	ids := make([]string, 0, len(items))
	seen := make(map[string]bool, len(items))
	for _, entity := range items {
		if !seen[entity.ReleaseID] {
			seen[entity.ReleaseID] = true
			ids = append(ids, entity.ReleaseID)
		}
	}
	releases, err := s.v2Pool.Statements().GetReleasesByIDs(ctx, projectID, ids)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to get releases from database")
	}
	byID := make(map[string]*domain.Release, len(releases))
	for _, release := range releases {
		byID[release.ID] = release
	}
	return byID, nil
}
