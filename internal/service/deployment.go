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

// CreateDeploymentInput carries a resolved release id and exact origins.
type CreateDeploymentInput struct {
	ProjectID  string
	ReleaseID  string
	TargetKind domain.DeploymentTargetKind
	Origins    []string
	Reason     domain.DeploymentReason
	Message    *string
	RollbackTo *string
	// ExpectedDeploymentID makes the write conditional. Not persisted.
	ExpectedDeploymentID *string
	// PreviewTTL is the lifetime of the previews a preview deploy renews.
	PreviewTTL time.Duration
}

// CreateDeploymentOutput reports Created false when nothing was written and
// Deployment is the newest deployment to the targets.
type CreateDeploymentOutput struct {
	Deployment *domain.Deployment
	Created    bool
}

type ListDeploymentsInput struct {
	ProjectID string
	// Origin narrows the list to one origin's history.
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

// Create deploys a release to its targets under the project lock, so
// concurrent deploys to the project serialize.
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
	if entity.TargetKind == domain.DeploymentTargetKindPreview && input.PreviewTTL <= 0 {
		return nil, domain.ErrDeploymentInvalid("a deployment to preview URLs needs a ttl", nil)
	}

	var output *CreateDeploymentOutput
	err = s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		output = nil
		stmts := tx.Statements()
		if err := stmts.LockProject(ctx, entity.ProjectID); err != nil {
			if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
				return domain.ErrProjectNotFound()
			}
			return err
		}
		serving, err := stmts.NewestTargets(ctx, entity.ProjectID, entity.Origins())
		if err != nil {
			return err
		}
		newest := domain.NewestTargetDeployment(serving)
		var current *domain.Deployment
		if newest != nil {
			if current, err = stmts.GetDeploymentByID(ctx, entity.ProjectID, newest.DeploymentID); err != nil {
				return err
			}
		}
		if err := domain.CheckExpectedDeployment(current, input.ExpectedDeploymentID); err != nil {
			return err
		}
		if entity.Unchanged(serving) {
			output = &CreateDeploymentOutput{Deployment: current}
			return nil
		}

		// A copy per attempt: a retried transaction mints and stamps afresh.
		written := *entity
		if err := stmts.InsertDeployment(ctx, &written, domain.DeployedNotBefore(newest)); err != nil {
			if _, ok := errors.AsType[*database.ForeignKeyError](err); ok {
				return domain.ErrReleaseNotFound()
			}
			return err
		}
		if written.TargetKind == domain.DeploymentTargetKindPreview {
			if err := stmts.UpsertPreviews(ctx, written.ProjectID, written.Origins(),
				written.DeployedAt.Add(input.PreviewTTL), written.DeployedAt); err != nil {
				return err
			}
		}
		if err := emitDeploymentCreated(ctx, stmts, &written); err != nil {
			return err
		}
		output = &CreateDeploymentOutput{Deployment: &written, Created: true}
		return nil
	})
	if err != nil {
		if de, ok := errors.AsType[domain.Error](err); ok {
			return nil, de
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to create deployment")
	}
	return output, nil
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
