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
	OriginKind domain.DeploymentOriginKind
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
// Deployment is the newest deployment to the origins.
type CreateDeploymentOutput struct {
	Deployment *domain.Deployment
	Created    bool
}

// DeployInput carries the targets as the request gives them.
type DeployInput struct {
	// HasTTL reports a ttl in the request, which only a preview deploy takes.
	HasTTL               bool
	ProjectID            string
	ReleaseID            string
	Targets              []string
	Reason               domain.DeploymentReason
	Message              *string
	ExpectedDeploymentID *string
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

// maxDeployAttempts bounds how often an unguarded deploy retries after losing
// the optimistic lock.
const maxDeployAttempts = 3

// Create deploys a release to its origins with optimistic locking: it reads
// what each origin serves and writes without holding a lock, and a concurrent
// deploy to one of the origins makes the write fail. A guarded deploy then
// answers a conflict with the winner; an unguarded one retries on top of it.
func (s *DeploymentService) Create(ctx context.Context, input CreateDeploymentInput) (*CreateDeploymentOutput, error) {
	actor, _ := audit.ActorFromContext(ctx)
	entity, err := domain.NewDeployment(input.ProjectID, input.ReleaseID, input.OriginKind, input.Origins, domain.DeploymentMetadata{
		Reason:         input.Reason,
		Message:        input.Message,
		RollbackTo:     input.RollbackTo,
		DeployedBy:     actor.ActorID,
		DeployedByType: actor.ActorType,
	})
	if err != nil {
		return nil, err
	}
	if entity.OriginKind == domain.DeploymentOriginKindPreview && input.PreviewTTL <= 0 {
		return nil, domain.ErrDeploymentInvalid().WithMessage("a deployment to preview URLs needs a ttl")
	}

	for attempt := 1; ; attempt++ {
		output, err := s.create(ctx, entity, input)
		if _, lost := errors.AsType[*database.UniqueError](err); lost {
			if input.ExpectedDeploymentID == nil && attempt < maxDeployAttempts {
				continue
			}
			return nil, s.conflict(ctx, entity)
		}
		if err != nil {
			if de, ok := errors.AsType[domain.Error](err); ok {
				return nil, de
			}
			return nil, domain.ErrInternal(err).WithMessage("failed to create deployment")
		}
		return output, nil
	}
}

// Deploy resolves the targets against the project's origins, then creates
// the deployment.
func (s *DeploymentService) Deploy(ctx context.Context, input DeployInput) (*CreateDeploymentOutput, error) {
	origins, err := s.projectOrigins(ctx, input.ProjectID)
	if err != nil {
		return nil, err
	}
	kind, resolved, err := domain.ResolveDeploymentTargets(origins, input.Targets)
	if err != nil {
		return nil, err
	}
	if input.HasTTL && kind == domain.DeploymentOriginKindPrimary {
		return nil, domain.ErrDeploymentInvalid().WithMessage("ttl is only valid for preview URLs")
	}
	return s.Create(ctx, CreateDeploymentInput{
		ProjectID:            input.ProjectID,
		ReleaseID:            input.ReleaseID,
		OriginKind:           kind,
		Origins:              resolved,
		Reason:               input.Reason,
		Message:              input.Message,
		ExpectedDeploymentID: input.ExpectedDeploymentID,
	})
}

func (s *DeploymentService) projectOrigins(ctx context.Context, projectID string) ([]domain.Origin, error) {
	project, err := s.v2Pool.Statements().GetProjectByID(ctx, projectID)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrProjectNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get project from database")
	}
	return project.Origins, nil
}

// conflict answers a deploy that lost the optimistic lock with the deployment
// it would have replaced.
func (s *DeploymentService) conflict(ctx context.Context, entity *domain.Deployment) error {
	_, current, err := servedBy(ctx, s.v2Pool.Statements(), entity)
	if err != nil {
		return domain.ErrInternal(err).WithMessage("failed to read the newest deployment")
	}
	return domain.ErrDeploymentConflict(domain.DeploymentConflictDetails{Deployment: current})
}

// servedBy reads what entity's origins hold, for the optimistic lock, and the
// deployment entity replaces: the project's newest primary deployment, or the
// newest deployment to its preview URLs. nil when there is none.
// TODO(#1572): lock primary deploys per project.
func servedBy(ctx context.Context, stmts AllStatements, entity *domain.Deployment) ([]domain.OriginDeployment, *domain.Deployment, error) {
	read, err := stmts.GetNewestPerOrigin(ctx, entity.ProjectID, entity.Origins())
	if err != nil {
		return nil, nil, err
	}
	if entity.OriginKind == domain.DeploymentOriginKindPrimary {
		newest, err := stmts.ListDeployments(WithAuthzListUnrestricted(ctx), deployment.NewestOfKindOptions(entity.ProjectID, domain.DeploymentOriginKindPrimary))
		if err != nil || len(newest.Items) == 0 {
			return read, nil, err
		}
		return read, newest.Items[0], nil
	}
	newest := domain.NewestOriginDeployment(read)
	if newest == nil {
		return read, nil, nil
	}
	current, err := stmts.GetDeploymentByID(ctx, entity.ProjectID, newest.DeploymentID)
	return read, current, err
}

// create is one attempt of Create, in one transaction.
func (s *DeploymentService) create(ctx context.Context, entity *domain.Deployment, input CreateDeploymentInput) (*CreateDeploymentOutput, error) {
	var output *CreateDeploymentOutput
	err := s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		output = nil
		stmts := tx.Statements()
		if _, err := stmts.GetReleaseByID(ctx, entity.ProjectID, entity.ReleaseID); err != nil {
			if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
				return domain.ErrReleaseNotFound()
			}
			return err
		}
		read, current, err := servedBy(ctx, stmts, entity)
		if err != nil {
			return err
		}
		if err := domain.CheckExpectedDeployment(current, input.ExpectedDeploymentID); err != nil {
			return err
		}
		if domain.DeploymentsEqual(entity, current) {
			output = &CreateDeploymentOutput{Deployment: current}
			return nil
		}

		// A copy per attempt: each one mints its own id and stamp.
		written := *entity
		if err := stmts.CreateDeployment(ctx, &written, read); err != nil {
			// The release was read above, so the only reference left to
			// trip is the project.
			if _, ok := errors.AsType[*database.ForeignKeyError](err); ok {
				return domain.ErrProjectNotFound()
			}
			return err
		}
		// TODO(#1781): freeze the deployment's variables here, in this transaction.
		if written.OriginKind == domain.DeploymentOriginKindPreview {
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
	return output, err
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
