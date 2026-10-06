package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/deployment"
)

// ---- Input / output types ---------------------------------------------------

const (
	// TargetDefault names the project default in a deploy request: what a
	// caller with no Origin is served. Stored as the empty origin.
	TargetDefault = "default"
	// TargetPrimary expands server-side to every primary pattern of the
	// project's allowlist.
	TargetPrimary = "primary"
)

// CreateDeploymentInput names a release and the targets to make it live on.
// Targets are the wire selectors: TargetDefault, TargetPrimary, or exact
// origins.
type CreateDeploymentInput struct {
	ProjectID  string
	ReleaseRef string
	Targets    []string
	Reason     domain.DeploymentReason
	// Message is the caller's summary of why this deployment happened.
	Message *string
	// TTL is how long the preview rows this deploy writes stay live. Required
	// when a target is a preview origin, rejected otherwise.
	TTL *time.Duration
	// ExpectedDeploymentID makes the write conditional on the first target
	// still serving that deployment. Not persisted.
	ExpectedDeploymentID *string
	// PreviewOnly refuses TargetDefault and TargetPrimary: the preview
	// credential may register preview origins and nothing else.
	PreviewOnly bool
}

// DeploymentOutput is the rows one deploy wrote, or, when Created is false,
// the rows every target already served with the same release and values.
type DeploymentOutput struct {
	DeployID string
	Release  *domain.Release
	Targets  []string
	Rows     []*domain.Deployment
	Warnings []string
	Created  bool
}

// RollbackInput addresses a deploy to undo or re-apply. A nil DeployID undoes
// the newest deploy; a non-nil Origin narrows the rows to one target.
type RollbackInput struct {
	ProjectID string
	DeployID  *string
	Origin    *string
	Message   *string
}

type ListDeploymentsInput struct {
	ProjectID string
	// Origin narrows the list to one target's history, the empty string
	// being the project default.
	Origin *string
	// DeployID narrows the list to the rows one deploy wrote.
	DeployID *string
	// Live lists the newest row per target instead of the log, with the
	// preview expiry joined in. Not paged.
	Live bool
	// IncludeReleases embeds the release each deployment made live (ADR 059).
	IncludeReleases bool
	PageToken       string
	Limit           int
}

type ListDeploymentsOutput struct {
	Items []*domain.Deployment
	// ExpiresAt holds, per preview origin in Items, when its live row ends.
	// Only filled by the live view.
	ExpiresAt map[string]time.Time
	// ReleasesByID holds the releases the listed deployments point at, keyed
	// by id, when IncludeReleases asked for them. Nil otherwise.
	ReleasesByID  map[string]*domain.Release
	NextPageToken string
}

type DeploymentService struct {
	v2Pool   *DB
	releases ReleaseService
	vars     VariableService
	now      func() time.Time
}

func NewDeploymentService(v2Pool *DB, releases ReleaseService, vars VariableService) *DeploymentService {
	return &DeploymentService{v2Pool: v2Pool, releases: releases, vars: vars, now: time.Now}
}

// deployTarget is one expanded target of a deploy.
type deployTarget struct {
	origin  string
	preview bool
}

// Create makes a release live on every target the request names, one row
// per target in one transaction under one deploy id. The variables each row
// runs are frozen from the store at this moment.
//
// Idempotent on release and values: when every target's newest row already
// names this release with the same frozen values, nothing is written and the
// existing rows are returned with Created false.
func (s *DeploymentService) Create(ctx context.Context, input CreateDeploymentInput) (*DeploymentOutput, error) {
	if !input.Reason.IsADeploymentReason() {
		return nil, domain.ErrDeploymentInvalid("unknown reason", nil)
	}
	release, err := s.releases.GetByRef(ctx, input.ProjectID, input.ReleaseRef)
	if err != nil {
		return nil, err
	}
	if release.Revoked() {
		return nil, domain.ErrReleaseRevoked()
	}
	project, err := s.project(ctx, input.ProjectID)
	if err != nil {
		return nil, err
	}

	targets, warnings, err := expandTargets(project, input.Targets)
	if err != nil {
		return nil, err
	}
	preview := targets[0].preview
	if preview && input.TTL == nil {
		return nil, domain.ErrDeploymentInvalid("a preview target needs a ttl", nil)
	}
	if !preview && input.TTL != nil {
		return nil, domain.ErrDeploymentInvalid("ttl is only valid for preview targets", nil)
	}
	if input.PreviewOnly && !preview {
		return nil, domain.ErrDeploymentPermissionDenied().WithMessage("the preview credential may only deploy to preview origins")
	}

	resolved, varWarnings, err := s.vars.ResolveForDeploy(ctx, input.ProjectID, preview)
	if err != nil {
		return nil, err
	}
	warnings = append(warnings, varWarnings...)

	if existing, err := s.alreadyServing(ctx, input.ProjectID, release.ID, targets, resolved); err != nil {
		return nil, err
	} else if existing != nil {
		return &DeploymentOutput{
			DeployID: existing[0].DeployID,
			Release:  release,
			Targets:  originsOf(targets),
			Rows:     existing,
			Warnings: warnings,
		}, nil
	}

	actor, _ := audit.ActorFromContext(ctx)
	rows := make([]*domain.Deployment, 0, len(targets))
	for _, target := range targets {
		row, err := domain.NewDeployment(input.ProjectID, target.origin, release.ID, domain.DeploymentMetadata{
			Reason:         input.Reason,
			Message:        input.Message,
			DeployedBy:     actor.ActorID,
			DeployedByType: actor.ActorType,
		})
		if err != nil {
			return nil, err
		}
		rows = append(rows, row)
	}

	frozen := func(row *domain.Deployment) []*domain.DeploymentVariable {
		return domain.FreezeVariables(row.ID, resolved)
	}
	var expires *time.Time
	if input.TTL != nil {
		at := s.now().Add(*input.TTL)
		expires = &at
	}
	deployID, err := s.write(ctx, input.ProjectID, rows, frozen, input.ExpectedDeploymentID, expires)
	if err != nil {
		return nil, err
	}
	return &DeploymentOutput{
		DeployID: deployID,
		Release:  release,
		Targets:  originsOf(targets),
		Rows:     rows,
		Warnings: warnings,
		Created:  true,
	}, nil
}

// Rollback undoes one deploy, or re-applies an earlier one: for every target
// it moved, a row naming the release that target should serve is appended
// under a new deploy id with reason rollback, carrying the frozen values of
// the deployment it restores.
func (s *DeploymentService) Rollback(ctx context.Context, input RollbackInput) (*DeploymentOutput, error) {
	stmts := s.v2Pool.Statements()
	undone, err := s.deployRows(ctx, input.ProjectID, input.DeployID)
	if err != nil {
		return nil, err
	}
	if input.Origin != nil {
		undone = slices.DeleteFunc(undone, func(row *domain.Deployment) bool { return row.Origin != *input.Origin })
		if len(undone) == 0 {
			return nil, domain.ErrDeploymentInvalid("the deploy did not move that target", nil)
		}
	}
	reapply := input.DeployID != nil

	actor, _ := audit.ActorFromContext(ctx)
	var (
		rows     []*domain.Deployment
		restored = make(map[string]*domain.Deployment)
		warnings []string
		targets  []string
		release  *domain.Release
	)
	for _, row := range undone {
		targets = append(targets, row.Origin)
		var restore *domain.Deployment
		if reapply {
			restore = row
		} else {
			restore, err = s.previousRelease(ctx, input.ProjectID, row)
			if err != nil {
				return nil, err
			}
			if restore == nil {
				warnings = append(warnings, fmt.Sprintf("%s: no earlier release, left as is", targetLabel(row.Origin)))
				continue
			}
		}
		newest, err := stmts.NewestDeployment(ctx, input.ProjectID, row.Origin)
		if err != nil && !isNoRow(err) {
			return nil, domain.ErrInternal(err).WithMessage("failed to read the target's newest deployment")
		}
		if newest != nil && newest.ReleaseID == restore.ReleaseID && newest.ID == restore.ID {
			warnings = append(warnings, fmt.Sprintf("%s: already serving that deployment", targetLabel(row.Origin)))
			continue
		}
		if release == nil || release.ID != restore.ReleaseID {
			release, err = s.releases.Get(ctx, input.ProjectID, restore.ReleaseID)
			if err != nil {
				return nil, err
			}
		}
		if release.Revoked() {
			return nil, domain.ErrReleaseRevoked()
		}
		undoneID := row.DeployID
		next, err := domain.NewDeployment(input.ProjectID, row.Origin, restore.ReleaseID, domain.DeploymentMetadata{
			Reason:         domain.DeploymentReasonRollback,
			Message:        input.Message,
			RollbackOf:     &undoneID,
			DeployedBy:     actor.ActorID,
			DeployedByType: actor.ActorType,
		})
		if err != nil {
			return nil, err
		}
		rows = append(rows, next)
		restored[row.Origin] = restore
	}
	if len(rows) == 0 {
		return &DeploymentOutput{Targets: targets, Warnings: warnings, Release: release}, nil
	}

	frozenByOrigin := make(map[string][]*domain.DeploymentVariable, len(rows))
	for origin, restore := range restored {
		values, err := stmts.GetDeploymentVariables(ctx, input.ProjectID, restore.ID)
		if err != nil {
			return nil, domain.ErrInternal(err).WithMessage("failed to read the restored deployment's variables")
		}
		frozenByOrigin[origin] = values
	}
	frozen := func(row *domain.Deployment) []*domain.DeploymentVariable {
		copied := make([]*domain.DeploymentVariable, 0, len(frozenByOrigin[row.Origin]))
		for _, v := range frozenByOrigin[row.Origin] {
			copied = append(copied, &domain.DeploymentVariable{
				ProjectID:    v.ProjectID,
				DeploymentID: row.ID,
				Name:         v.Name,
				Value:        v.Value,
				IsSecret:     v.IsSecret,
			})
		}
		return copied
	}
	deployID, err := s.write(ctx, input.ProjectID, rows, frozen, nil, nil)
	if err != nil {
		return nil, err
	}
	return &DeploymentOutput{
		DeployID: deployID,
		Release:  release,
		Targets:  targets,
		Rows:     rows,
		Warnings: warnings,
		Created:  true,
	}, nil
}

// write appends rows under one minted deploy id, freezes each row's values
// and renews the preview rows, all in one transaction behind the project
// lock.
func (s *DeploymentService) write(
	ctx context.Context,
	projectID string,
	rows []*domain.Deployment,
	frozen func(*domain.Deployment) []*domain.DeploymentVariable,
	expectedDeploymentID *string,
	previewExpiry *time.Time,
) (string, error) {
	var deployID string
	err := s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()
		if err := stmts.LockProject(ctx, projectID); err != nil {
			return err
		}
		if expectedDeploymentID != nil {
			newest, err := stmts.NewestDeployment(ctx, projectID, rows[0].Origin)
			if err != nil && !isNoRow(err) {
				return err
			}
			if newest == nil || newest.ID != *expectedDeploymentID {
				details := domain.DeploymentConflictDetails{}
				if newest != nil {
					details.CurrentDeploymentID = newest.ID
					details.CurrentReleaseID = newest.ReleaseID
				}
				return domain.ErrDeploymentConflict(details)
			}
		}
		id, err := stmts.NewManagedID(string(domain.PrefixDeploy))
		if err != nil {
			return err
		}
		deployID = id
		for _, row := range rows {
			row.DeployID = deployID
		}
		if err := stmts.CreateDeployments(ctx, rows); err != nil {
			return err
		}
		for _, row := range rows {
			if values := frozen(row); len(values) > 0 {
				if err := stmts.CreateDeploymentVariables(ctx, values); err != nil {
					return err
				}
			}
			if previewExpiry != nil {
				if err := stmts.UpsertOrigin(ctx, &domain.Origin{
					ProjectID: projectID,
					Origin:    row.Origin,
					ExpiresAt: *previewExpiry,
				}); err != nil {
					return err
				}
			}
			if err := emitDeploymentCreated(ctx, stmts, row); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		if isNoRow(err) {
			return "", domain.ErrProjectNotFound()
		}
		if _, ok := errors.AsType[*database.ForeignKeyError](err); ok {
			return "", domain.ErrDeploymentInvalid("release not found in this project", err)
		}
		if de, ok := errors.AsType[domain.Error](err); ok {
			return "", de
		}
		return "", domain.ErrInternal(err).WithMessage("failed to create deployment")
	}
	return deployID, nil
}

// expandTargets turns the wire selectors into exact targets, checked against
// the allowlist. Mixing preview origins with the default or a primary is
// refused: a preview run never moves production.
func expandTargets(project *domain.Project, selectors []string) ([]deployTarget, []string, error) {
	if len(selectors) == 0 {
		return nil, nil, domain.ErrDeploymentInvalid("at least one target is required", nil)
	}
	var (
		targets  []deployTarget
		warnings []string
		seen     = make(map[string]bool)
	)
	add := func(t deployTarget) {
		if !seen[t.origin] {
			seen[t.origin] = true
			targets = append(targets, t)
		}
	}
	for _, selector := range selectors {
		switch strings.TrimSpace(selector) {
		case TargetDefault:
			add(deployTarget{origin: ""})
		case TargetPrimary:
			for _, entry := range project.AllowedOrigins {
				if entry.Kind != domain.OriginKindPrimary {
					continue
				}
				if strings.Contains(entry.Pattern, "*") {
					warnings = append(warnings, fmt.Sprintf("%s: a wildcard primary is not a target, skipped", entry.Pattern))
					continue
				}
				add(deployTarget{origin: entry.Pattern})
			}
		default:
			origin, err := domain.NormalizeOrigin(selector)
			if err != nil {
				return nil, nil, domain.ErrDeploymentInvalid(map[string]string{"target": selector, "reason": "not a target: use default, primary, or an exact origin"}, err)
			}
			matched, ok := domain.MatchAllowedOrigin(project.AllowedOrigins, origin)
			if !ok {
				return nil, nil, domain.ErrProjectOriginNotAllowed(map[string]string{"origin": origin})
			}
			add(deployTarget{origin: origin, preview: matched.Kind == domain.OriginKindPreview})
		}
	}
	if len(targets) == 0 {
		return nil, nil, domain.ErrDeploymentInvalid("the targets expand to nothing: the project has no primary origin", nil)
	}
	preview := targets[0].preview
	for _, target := range targets[1:] {
		if target.preview != preview {
			return nil, nil, domain.ErrDeploymentInvalid("preview origins cannot be deployed together with the default or a primary origin", nil)
		}
	}
	return targets, warnings, nil
}

func originsOf(targets []deployTarget) []string {
	origins := make([]string, len(targets))
	for i, target := range targets {
		origins[i] = target.origin
	}
	return origins
}

func targetLabel(origin string) string {
	if origin == "" {
		return "(default)"
	}
	return origin
}

// alreadyServing returns the newest rows of every target when all of them
// already name releaseID with the same frozen values, else nil.
func (s *DeploymentService) alreadyServing(ctx context.Context, projectID, releaseID string, targets []deployTarget, resolved []*domain.Variable) ([]*domain.Deployment, error) {
	stmts := s.v2Pool.Statements()
	rows := make([]*domain.Deployment, 0, len(targets))
	for _, target := range targets {
		newest, err := stmts.NewestDeployment(ctx, projectID, target.origin)
		if err != nil {
			if isNoRow(err) {
				return nil, nil
			}
			return nil, domain.ErrInternal(err).WithMessage("failed to read the target's newest deployment")
		}
		if newest.ReleaseID != releaseID {
			return nil, nil
		}
		frozen, err := stmts.GetDeploymentVariables(ctx, projectID, newest.ID)
		if err != nil {
			return nil, domain.ErrInternal(err).WithMessage("failed to read the deployment's variables")
		}
		if !sameFrozenValues(frozen, resolved) {
			return nil, nil
		}
		rows = append(rows, newest)
	}
	return rows, nil
}

// sameFrozenValues reports whether a deployment's frozen set equals the
// values the store resolves to now. A secret compares by its ciphertext, so
// a rotated secret counts as a change.
func sameFrozenValues(frozen []*domain.DeploymentVariable, resolved []*domain.Variable) bool {
	if len(frozen) != len(resolved) {
		return false
	}
	byName := make(map[string]*domain.DeploymentVariable, len(frozen))
	for _, v := range frozen {
		byName[v.Name] = v
	}
	for _, v := range resolved {
		other, ok := byName[v.Name]
		if !ok || other.IsSecret != v.IsSecret {
			return false
		}
		a, errA := json.Marshal(other.Value)
		b, errB := json.Marshal(v.Value)
		if errA != nil || errB != nil || !bytes.Equal(a, b) {
			return false
		}
	}
	return true
}

// deployRows reads the rows one deploy wrote, or the newest deploy's rows
// when deployID is nil.
func (s *DeploymentService) deployRows(ctx context.Context, projectID string, deployID *string) ([]*domain.Deployment, error) {
	// Nested reads on behalf of a caller the handler already authorised.
	ctx = WithAuthzListUnrestricted(ctx)
	stmts := s.v2Pool.Statements()
	id := deployID
	if id == nil {
		page, err := stmts.ListDeployments(ctx, deployment.ListOptions(projectID, nil, nil, 1))
		if err != nil {
			return nil, mapListError(err, "failed to list deployments")
		}
		if len(page.Items) == 0 {
			return nil, domain.ErrDeploymentNotFound().WithMessage("the project has no deployment to roll back")
		}
		id = &page.Items[0].DeployID
	}
	page, err := stmts.ListDeployments(ctx, deployment.ListOptions(projectID, nil, id, 100))
	if err != nil {
		return nil, mapListError(err, "failed to list deployments")
	}
	if len(page.Items) == 0 {
		return nil, domain.ErrDeploymentNotFound()
	}
	return page.Items, nil
}

// previousRelease finds the newest row on row's target that names a release
// other than row's and does not belong to row's deploy, or nil when the
// target has served nothing else.
func (s *DeploymentService) previousRelease(ctx context.Context, projectID string, row *domain.Deployment) (*domain.Deployment, error) {
	origin := row.Origin
	page, err := s.v2Pool.Statements().ListDeployments(WithAuthzListUnrestricted(ctx), deployment.ListOptions(projectID, &origin, nil, 100))
	if err != nil {
		return nil, mapListError(err, "failed to list deployments")
	}
	for _, candidate := range page.Items {
		if candidate.DeployID == row.DeployID || candidate.ReleaseID == row.ReleaseID {
			continue
		}
		return candidate, nil
	}
	return nil, nil
}

func (s *DeploymentService) project(ctx context.Context, projectID string) (*domain.Project, error) {
	project, err := s.v2Pool.Statements().GetProjectByID(ctx, projectID)
	if err != nil {
		if isNoRow(err) {
			return nil, domain.ErrProjectNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to read the project")
	}
	return project, nil
}

func isNoRow(err error) bool {
	_, ok := errors.AsType[*database.NoRowFoundError](err)
	return ok
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
		if isNoRow(err) {
			return nil, domain.ErrDeploymentNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to get deployment from database")
	}
	return entity, nil
}

// GetVariables returns the values frozen onto one deployment.
func (s *DeploymentService) GetVariables(ctx context.Context, projectID, id string) ([]*domain.DeploymentVariable, error) {
	if _, err := s.Get(ctx, projectID, id); err != nil {
		return nil, err
	}
	values, err := s.v2Pool.Statements().GetDeploymentVariables(ctx, projectID, id)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to get deployment variables from database")
	}
	return values, nil
}

func (s *DeploymentService) List(ctx context.Context, input ListDeploymentsInput) (*ListDeploymentsOutput, error) {
	stmts := s.v2Pool.Statements()
	output := &ListDeploymentsOutput{}
	if input.Live {
		items, err := stmts.ListLiveDeployments(ctx, input.ProjectID)
		if err != nil {
			return nil, mapListError(err, "failed to list live deployments")
		}
		origins, err := stmts.ListOrigins(ctx, input.ProjectID)
		if err != nil {
			return nil, domain.ErrInternal(err).WithMessage("failed to list origins")
		}
		output.Items = items
		output.ExpiresAt = make(map[string]time.Time, len(origins))
		for _, origin := range origins {
			output.ExpiresAt[origin.Origin] = origin.ExpiresAt
		}
	} else {
		opts := deployment.ListOptions(input.ProjectID, input.Origin, input.DeployID, uint32(normalizeLimit(input.Limit)))
		opts.Pagination.Cursor = []byte(input.PageToken)
		result, err := stmts.ListDeployments(ctx, opts)
		if err != nil {
			return nil, mapListError(err, "failed to list deployments")
		}
		output.Items = result.Items
		output.NextPageToken = string(result.NextCursor)
	}
	if input.IncludeReleases {
		releases, err := s.releasesFor(ctx, input.ProjectID, output.Items)
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

// ---- Origins ---------------------------------------------------------------

// ListOrigins returns the project's live preview rows, expired ones left out.
func (s *DeploymentService) ListOrigins(ctx context.Context, projectID string) ([]*domain.Origin, error) {
	rows, err := s.v2Pool.Statements().ListOrigins(ctx, projectID)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to list origins")
	}
	now := s.now()
	live := rows[:0]
	for _, row := range rows {
		if !row.Expired(now) {
			live = append(live, row)
		}
	}
	return live, nil
}

// RemoveOrigin retires one preview URL: its row goes, its deployment rows stay.
func (s *DeploymentService) RemoveOrigin(ctx context.Context, projectID, origin string) error {
	normalized, err := domain.NormalizeOrigin(origin)
	if err != nil {
		return err
	}
	if err := s.v2Pool.Statements().DeleteOrigin(ctx, projectID, normalized); err != nil {
		if isNoRow(err) {
			return domain.ErrOriginNotFound()
		}
		return domain.ErrInternal(err).WithMessage("failed to delete origin")
	}
	return nil
}
