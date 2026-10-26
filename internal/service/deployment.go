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
	RollbackTo           *string
	ExpectedDeploymentID *string
}

type RollbackDeploymentInput struct {
	ProjectID            string
	DeploymentID         string
	Message              *string
	ExpectedDeploymentID *string
}

type ListDeploymentsInput struct {
	ProjectID string
	// Origin narrows the list to one origin's history.
	Origin *string
	// Live lists what is served now instead of the history.
	Live bool
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
	ReleasesByID map[string]*domain.Release
	// Live holds the ids of the listed deployments that are live now.
	Live          map[string]bool
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
func (s *DeploymentService) Create(ctx context.Context, input CreateDeploymentInput) (_ *CreateDeploymentOutput, err error) {
	ctx, end := startSpan(ctx, "DeploymentService.Create")
	defer end(&err)

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
func (s *DeploymentService) Deploy(ctx context.Context, input DeployInput) (_ *CreateDeploymentOutput, err error) {
	ctx, end := startSpan(ctx, "DeploymentService.Deploy")
	defer end(&err)

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
	var ttl time.Duration
	// TODO(#2210): take the request's ttl instead of the default.
	if kind == domain.DeploymentOriginKindPreview {
		ttl = domain.DefaultPreviewTTL
	}
	return s.Create(ctx, CreateDeploymentInput{
		ProjectID:            input.ProjectID,
		ReleaseID:            input.ReleaseID,
		OriginKind:           kind,
		Origins:              resolved,
		Reason:               input.Reason,
		Message:              input.Message,
		RollbackTo:           input.RollbackTo,
		ExpectedDeploymentID: input.ExpectedDeploymentID,
		PreviewTTL:           ttl,
	})
}

// Rollback re-deploys the release of a primary deployment to primary, which
// covers every current primary origin.
func (s *DeploymentService) Rollback(ctx context.Context, input RollbackDeploymentInput) (_ *CreateDeploymentOutput, err error) {
	ctx, end := startSpan(ctx, "DeploymentService.Rollback")
	defer end(&err)

	previous, err := s.Get(ctx, input.ProjectID, input.DeploymentID)
	if err != nil {
		return nil, err
	}
	if previous.OriginKind != domain.DeploymentOriginKindPrimary {
		return nil, domain.ErrDeploymentInvalid().WithMessage("a deployment to preview URLs cannot be rolled back")
	}
	return s.Deploy(ctx, DeployInput{
		ProjectID:            input.ProjectID,
		ReleaseID:            previous.ReleaseID,
		Targets:              []string{domain.DeploymentTargetPrimary},
		Reason:               domain.DeploymentReasonRollback,
		Message:              input.Message,
		RollbackTo:           &previous.ID,
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
		current, err := newestPrimary(ctx, stmts, entity.ProjectID)
		return read, current, err
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
		release, err := stmts.GetReleaseByID(ctx, entity.ProjectID, entity.ReleaseID)
		if err != nil {
			if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
				return domain.ErrReleaseNotFound()
			}
			return err
		}
		// TODO(#2206): a concurrent revoke of this release can land after this check.
		if release.Revoked() {
			return domain.ErrReleaseRevoked()
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
		// TODO(#1781): resolve the set before DeploymentsEqual, from RollbackTo's
		// frozen set. This copies the current values.
		if _, err := stmts.FreezeDeploymentVariables(ctx, written.ProjectID, written.ID); err != nil {
			return err
		}
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

func (s *DeploymentService) Get(ctx context.Context, projectID, id string) (_ *domain.Deployment, err error) {
	ctx, end := startSpan(ctx, "DeploymentService.Get")
	defer end(&err)

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
func (s *DeploymentService) GetByIDs(ctx context.Context, projectID string, ids []string) (_ map[string]*domain.Deployment, err error) {
	ctx, end := startSpan(ctx, "DeploymentService.GetByIDs")
	defer end(&err)

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

func (s *DeploymentService) List(ctx context.Context, input ListDeploymentsInput) (_ *ListDeploymentsOutput, err error) {
	ctx, end := startSpan(ctx, "DeploymentService.List")
	defer end(&err)

	list := s.listHistory
	if input.Live {
		list = s.listLive
	}
	result, live, err := list(ctx, input)
	if err != nil {
		return nil, err
	}

	output := &ListDeploymentsOutput{
		Items:         result.Items,
		Live:          live,
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

// listHistory lists the project's deployments newest first, with the ids of
// the listed ones that are live now.
func (s *DeploymentService) listHistory(ctx context.Context, input ListDeploymentsInput) (*database.ListResult[*domain.Deployment], map[string]bool, error) {
	opts := deployment.ListOptions(input.ProjectID, input.Origin, uint32(normalizeLimit(input.Limit)))
	opts.Pagination.Cursor = []byte(input.PageToken)
	result, err := s.v2Pool.Statements().ListDeployments(ctx, opts)
	if err != nil {
		return nil, nil, mapListError(err, "failed to list deployments")
	}
	live, err := s.liveIDs(ctx, input.ProjectID, result.Items)
	return result, live, err
}

// listLive is the live view, newest first: the deployments some origin serves
// now, each narrowed to the origins it serves, so all of them are live. With
// an origin, it is the one deployment serving it.
func (s *DeploymentService) listLive(ctx context.Context, input ListDeploymentsInput) (*database.ListResult[*domain.Deployment], map[string]bool, error) {
	now := time.Now()
	opts := deployment.LiveListOptions(input.ProjectID, nil, uint32(normalizeLimit(input.Limit)))
	opts.Pagination.Cursor = []byte(input.PageToken)
	if input.Origin != nil {
		opts.Filter = database.And(opts.Filter, deployment.ServesOrigin(*input.Origin, now))
	}
	result, err := s.v2Pool.Statements().ListLiveDeployments(ctx, now, opts)
	if err != nil {
		return nil, nil, mapListError(err, "failed to list live deployments")
	}
	live := make(map[string]bool, len(result.Items))
	for _, entity := range result.Items {
		live[entity.ID] = true
	}
	return result, live, nil
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

// Read gets a deployment and whether it is live now.
func (s *DeploymentService) Read(ctx context.Context, projectID, id string) (_ *domain.Deployment, _ bool, err error) {
	ctx, end := startSpan(ctx, "DeploymentService.Read")
	defer end(&err)

	entity, err := s.Get(ctx, projectID, id)
	if err != nil {
		return nil, false, err
	}
	live, err := s.liveIDs(ctx, projectID, []*domain.Deployment{entity})
	if err != nil {
		return nil, false, err
	}
	return entity, live[entity.ID], nil
}

// liveIDs reports which of items are live, by the storage live predicate. It
// is a status lookup, not the caller's list, so it reads unfiltered.
func (s *DeploymentService) liveIDs(ctx context.Context, projectID string, items []*domain.Deployment) (map[string]bool, error) {
	live := make(map[string]bool, len(items))
	if len(items) == 0 {
		return live, nil
	}
	result, err := s.v2Pool.Statements().ListLiveDeployments(WithAuthzListUnrestricted(ctx), time.Now(), &database.ListOptions[domain.DeploymentField]{
		Filter:     deployment.ByIDs(projectID, deployment.DeploymentIDs(items)),
		Pagination: database.Page[domain.DeploymentField]{Limit: uint32(len(items)), OrderBy: deployment.NewestFirst()},
	})
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to read the live deployments")
	}
	for _, entity := range result.Items {
		live[entity.ID] = true
	}
	return live, nil
}

// newestPrimary is the project's newest primary deployment, nil when none.
// It is a lookup, not the caller's list, so it reads unfiltered.
func newestPrimary(ctx context.Context, stmts DeploymentStatements, projectID string) (*domain.Deployment, error) {
	result, err := stmts.ListDeployments(WithAuthzListUnrestricted(ctx), deployment.NewestOfKindOptions(projectID, domain.DeploymentOriginKindPrimary))
	if err != nil || len(result.Items) == 0 {
		return nil, err
	}
	return result.Items[0], nil
}
