package service

import (
	"context"
	"errors"
	"slices"
	"strings"
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
	var result *database.ListResult[*domain.Deployment]
	var err error
	if input.Live {
		result, err = s.listLive(ctx, input)
	} else {
		opts := deployment.ListOptions(input.ProjectID, input.Origin, uint32(normalizeLimit(input.Limit)))
		opts.Pagination.Cursor = []byte(input.PageToken)
		result, err = s.v2Pool.Statements().ListDeployments(ctx, opts)
	}
	if err != nil {
		if de, ok := errors.AsType[domain.Error](err); ok {
			return nil, de
		}
		return nil, mapListError(err, "failed to list deployments")
	}

	output := &ListDeploymentsOutput{
		Items:         result.Items,
		NextPageToken: string(result.NextCursor),
	}
	if input.Live {
		output.Live = make(map[string]bool, len(result.Items))
		for _, entity := range result.Items {
			output.Live[entity.ID] = true
		}
	} else if output.Live, err = s.liveIDs(ctx, input.ProjectID, result.Items); err != nil {
		return nil, err
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

// Read gets a deployment and whether it is live now.
func (s *DeploymentService) Read(ctx context.Context, projectID, id string) (*domain.Deployment, bool, error) {
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

// liveIDs reports which of items are live: a primary deployment while it is
// the project's newest primary deployment and covers a primary origin, a
// preview one while one of its URLs still serves it.
func (s *DeploymentService) liveIDs(ctx context.Context, projectID string, items []*domain.Deployment) (map[string]bool, error) {
	stmts := s.v2Pool.Statements()
	live := make(map[string]bool, len(items))
	var previews []string
	hasPrimary := false
	for _, entity := range items {
		if entity.OriginKind == domain.DeploymentOriginKindPreview {
			previews = append(previews, entity.ID)
		} else {
			hasPrimary = true
		}
	}
	if hasPrimary {
		origins, err := s.projectOrigins(ctx, projectID)
		if err != nil {
			return nil, err
		}
		newest, err := s.livePrimary(ctx, projectID, domain.PrimaryOrigins(origins))
		if err != nil {
			return nil, domain.ErrInternal(err).WithMessage("failed to read the newest primary deployment")
		}
		if newest != nil {
			live[newest.ID] = true
		}
	}
	if len(previews) > 0 {
		result, err := stmts.ListLiveDeployments(WithAuthzListUnrestricted(ctx), time.Now(), &database.ListOptions[domain.DeploymentField]{
			Filter:     deployment.ByIDs(projectID, previews),
			Pagination: database.Page[domain.DeploymentField]{Limit: uint32(len(previews)), OrderBy: deployment.NewestFirst()},
		})
		if err != nil {
			return nil, domain.ErrInternal(err).WithMessage("failed to read the live deployments")
		}
		for _, entity := range result.Items {
			live[entity.ID] = true
		}
	}
	return live, nil
}

// listLive is the live view: the project's newest primary deployment first,
// narrowed to the origins that are still primary origins, then the newest
// deployment to each live preview URL, newest first.
func (s *DeploymentService) listLive(ctx context.Context, input ListDeploymentsInput) (*database.ListResult[*domain.Deployment], error) {
	origins, err := s.projectOrigins(ctx, input.ProjectID)
	if err != nil {
		return nil, err
	}
	if input.Origin != nil {
		served, err := s.servedAt(ctx, input.ProjectID, domain.PrimaryOrigins(origins), *input.Origin)
		if err != nil || served == nil {
			return &database.ListResult[*domain.Deployment]{}, err
		}
		return &database.ListResult[*domain.Deployment]{Items: []*domain.Deployment{served}}, nil
	}

	// A later page's token is livePreviewsToken and the preview cursor.
	cursor, later := strings.CutPrefix(input.PageToken, livePreviewsToken)
	if input.PageToken != "" && !later {
		return nil, database.ErrInvalidCursor()
	}
	limit := uint32(normalizeLimit(input.Limit))
	var items []*domain.Deployment
	if !later {
		primary, err := s.livePrimary(ctx, input.ProjectID, domain.PrimaryOrigins(origins))
		if err == nil {
			primary, err = s.visibleTo(ctx, primary)
		}
		if err != nil {
			return nil, err
		}
		if primary != nil {
			items = append(items, primary)
			limit--
		}
	}
	// A page holding only the primary deployment still looks for one preview,
	// to know whether a later page exists.
	opts := deployment.LiveListOptions(input.ProjectID, nil, max(limit, 1))
	opts.Filter = database.And(opts.Filter,
		database.Equal(database.Col(domain.DeploymentFieldOriginKind), domain.DeploymentOriginKindPreview.String()))
	opts.Pagination.Cursor = []byte(cursor)
	result, err := s.v2Pool.Statements().ListLiveDeployments(ctx, time.Now(), opts)
	if err != nil {
		return nil, err
	}
	if limit == 0 {
		next := []byte(nil)
		if len(result.Items) > 0 {
			next = []byte(livePreviewsToken)
		}
		return &database.ListResult[*domain.Deployment]{Items: items, NextCursor: next}, nil
	}
	result.Items = append(items, result.Items...)
	if len(result.NextCursor) > 0 {
		result.NextCursor = append([]byte(livePreviewsToken), result.NextCursor...)
	}
	return result, nil
}

// servedAt is the deployment origin serves, nil for none: for a primary
// origin the newest primary deployment when it covers it, for a preview URL
// its newest preview deployment while the preview is live.
func (s *DeploymentService) servedAt(ctx context.Context, projectID string, primaryOrigins []string, origin string) (*domain.Deployment, error) {
	if slices.Contains(primaryOrigins, origin) {
		served, err := s.livePrimary(ctx, projectID, []string{origin})
		if err != nil {
			return nil, err
		}
		return s.visibleTo(ctx, served)
	}
	served, err := s.v2Pool.Statements().GetLiveDeployment(ctx, projectID, origin, time.Now())
	if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
		return nil, nil
	}
	// A primary row on an origin that is no longer primary serves nothing.
	if err != nil || served.OriginKind != domain.DeploymentOriginKindPreview {
		return nil, err
	}
	return s.visibleTo(ctx, served)
}

// visibleTo returns entity when the caller's list filter admits it, nil
// otherwise. A caller with project-wide access carries no filter.
func (s *DeploymentService) visibleTo(ctx context.Context, entity *domain.Deployment) (*domain.Deployment, error) {
	if entity == nil {
		return nil, nil
	}
	if _, filtered := AuthzListFilterFromContext(ctx); !filtered {
		return entity, nil
	}
	result, err := s.v2Pool.Statements().ListDeployments(ctx, &database.ListOptions[domain.DeploymentField]{
		Filter:     deployment.ByIDs(entity.ProjectID, []string{entity.ID}),
		Pagination: database.Page[domain.DeploymentField]{Limit: 1, OrderBy: deployment.NewestFirst()},
	})
	if err != nil || len(result.Items) == 0 {
		return nil, err
	}
	return entity, nil
}

// livePrimary is the project's newest primary deployment narrowed to origins,
// nil when there is none or it covers none of them.
func (s *DeploymentService) livePrimary(ctx context.Context, projectID string, origins []string) (*domain.Deployment, error) {
	newest, err := newestPrimary(ctx, s.v2Pool.Statements(), projectID)
	if err != nil {
		return nil, err
	}
	return narrowed(newest, origins), nil
}

// livePreviewsToken prefixes the page token of a later live-view page, which
// lists previews only.
const livePreviewsToken = "p"

// narrowed copies the deployment with only the targets still in origins, nil
// when none is.
func narrowed(entity *domain.Deployment, origins []string) *domain.Deployment {
	if entity == nil {
		return nil
	}
	out := *entity
	out.Targets = slices.DeleteFunc(slices.Clone(entity.Targets), func(t domain.DeploymentTarget) bool {
		return !slices.Contains(origins, t.Origin)
	})
	if len(out.Targets) == 0 {
		return nil
	}
	return &out
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
