package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
	// project's origins.
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

// RollbackNothingToUndo is the message of the dep.invalid a rollback answers
// when no requested target has an earlier release to return to; the details
// carry one note per target.
const RollbackNothingToUndo = "no target of the deployment has an earlier release to return to"

// DeploymentOutput is the deployment one call wrote, or, when Created is
// false, the one every target already served with the same release and
// values.
type DeploymentOutput struct {
	Deployment *domain.Deployment
	Release    *domain.Release
	Warnings   []string
	Created    bool
}

// RollbackInput addresses a deployment to undo or re-apply. A nil
// DeploymentID undoes the newest deployment; a non-nil Origin narrows the
// targets to one.
type RollbackInput struct {
	ProjectID    string
	DeploymentID *string
	Origin       *string
	Message      *string
}

type ListDeploymentsInput struct {
	ProjectID string
	// Origin narrows the list to the deployments that touched one target,
	// the empty string being the project default.
	Origin *string
	// Live lists what every target serves instead of the log: the
	// deployments current for at least one target, each with only those
	// targets, the preview expiry joined in. Not paged.
	Live bool
	// IncludeReleases embeds the release each deployment made live (ADR 059).
	IncludeReleases bool
	PageToken       string
	Limit           int
}

type ListDeploymentsOutput struct {
	Items []*domain.Deployment
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

// Create makes a release live on every target the request names, as one
// deployment in one transaction. The variables the deployment runs are
// frozen from the store at this moment.
//
// Idempotent on release and values: when every target already serves this
// release from one deployment with the same frozen values, nothing is
// written and that deployment is returned with Created false.
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
		return &DeploymentOutput{Deployment: existing, Release: release, Warnings: warnings}, nil
	}

	actor, _ := audit.ActorFromContext(ctx)
	entity, err := domain.NewDeployment(input.ProjectID, originsOf(targets), release.ID, domain.DeploymentMetadata{
		Reason:         input.Reason,
		Message:        input.Message,
		DeployedBy:     actor.ActorID,
		DeployedByType: actor.ActorType,
	})
	if err != nil {
		return nil, err
	}

	var expires *time.Time
	if input.TTL != nil {
		at := s.now().Add(*input.TTL)
		expires = &at
	}
	frozen := func(id string) []*domain.DeploymentVariable { return domain.FreezeVariables(id, resolved) }
	if err := s.write(ctx, entity, frozen, input.ExpectedDeploymentID, expires); err != nil {
		return nil, err
	}
	return &DeploymentOutput{Deployment: entity, Release: release, Warnings: warnings, Created: true}, nil
}

// Rollback undoes one deployment, or re-applies an earlier one: every target
// it moved goes back to the release it served before, in one new deployment
// with reason rollback that carries the frozen values of the deployment it
// restores.
//
// The restored targets may have served different releases before the undone
// deployment moved them. A rollback is one deployment of one release, so
// each distinct earlier release is written as a deployment of its own.
func (s *DeploymentService) Rollback(ctx context.Context, input RollbackInput) (*DeploymentOutput, error) {
	stmts := s.v2Pool.Statements()
	undone, err := s.deploymentToUndo(ctx, input.ProjectID, input.DeploymentID)
	if err != nil {
		return nil, err
	}
	origins := undone.Origins()
	if input.Origin != nil {
		if !containsOrigin(origins, *input.Origin) {
			return nil, domain.ErrDeploymentInvalid("the deployment did not move that target", nil)
		}
		origins = []string{*input.Origin}
	}
	reapply := input.DeploymentID != nil

	var (
		warnings []string
		// The deployment each origin goes back to, grouped by release so
		// one rollback deployment is written per release.
		restoredByOrigin = make(map[string]*domain.Deployment)
		originsByRelease = make(map[string][]string)
		releaseOrder     []string
	)
	for _, origin := range origins {
		restore := undone
		if !reapply {
			restore, err = s.previousRelease(ctx, input.ProjectID, undone, origin)
			if err != nil {
				return nil, err
			}
			if restore == nil {
				warnings = append(warnings, fmt.Sprintf("%s: no earlier release, left as is", targetLabel(origin)))
				continue
			}
		}
		newest, err := stmts.NewestDeployment(ctx, input.ProjectID, origin)
		if err != nil && !isNoRow(err) {
			return nil, domain.ErrInternal(err).WithMessage("failed to read the target's newest deployment")
		}
		if newest != nil && newest.ID == restore.ID {
			warnings = append(warnings, fmt.Sprintf("%s: already serving that deployment", targetLabel(origin)))
			continue
		}
		restoredByOrigin[origin] = restore
		if _, seen := originsByRelease[restore.ReleaseID]; !seen {
			releaseOrder = append(releaseOrder, restore.ReleaseID)
		}
		originsByRelease[restore.ReleaseID] = append(originsByRelease[restore.ReleaseID], origin)
	}
	if len(releaseOrder) == 0 {
		return nil, domain.ErrDeploymentInvalid(map[string]any{"warnings": warnings}, nil).WithMessage(RollbackNothingToUndo)
	}

	actor, _ := audit.ActorFromContext(ctx)
	output := &DeploymentOutput{Warnings: warnings, Created: true}
	for _, releaseID := range releaseOrder {
		release, err := s.releases.Get(ctx, input.ProjectID, releaseID)
		if err != nil {
			return nil, err
		}
		if release.Revoked() {
			return nil, domain.ErrReleaseRevoked()
		}
		undoneID := undone.ID
		next, err := domain.NewDeployment(input.ProjectID, originsByRelease[releaseID], releaseID, domain.DeploymentMetadata{
			Reason:         domain.DeploymentReasonRollback,
			Message:        input.Message,
			RollbackOf:     &undoneID,
			DeployedBy:     actor.ActorID,
			DeployedByType: actor.ActorType,
		})
		if err != nil {
			return nil, err
		}
		// Every origin of this rollback restores a deployment of the same
		// release; the first one's frozen values travel with it.
		restored := restoredByOrigin[originsByRelease[releaseID][0]]
		values, err := stmts.GetDeploymentVariables(ctx, input.ProjectID, restored.ID)
		if err != nil {
			return nil, domain.ErrInternal(err).WithMessage("failed to read the restored deployment's variables")
		}
		frozen := func(id string) []*domain.DeploymentVariable {
			copied := make([]*domain.DeploymentVariable, 0, len(values))
			for _, v := range values {
				copied = append(copied, &domain.DeploymentVariable{
					ProjectID:    v.ProjectID,
					DeploymentID: id,
					Name:         v.Name,
					Value:        v.Value,
					IsSecret:     v.IsSecret,
				})
			}
			return copied
		}
		if err := s.write(ctx, next, frozen, nil, nil); err != nil {
			return nil, err
		}
		// The answer carries the first deployment written; a rollback that
		// had to split over releases names the others in warnings.
		if output.Deployment == nil {
			output.Deployment = next
			output.Release = release
		} else {
			output.Warnings = append(output.Warnings, fmt.Sprintf("%s served %s before and rolled back as %s", strings.Join(originsByRelease[releaseID], ", "), releaseID, next.ID))
		}
	}
	return output, nil
}

// write appends the deployment and its targets, freezes its values and
// renews the preview rows, all in one transaction behind the project lock.
func (s *DeploymentService) write(
	ctx context.Context,
	entity *domain.Deployment,
	frozen func(deploymentID string) []*domain.DeploymentVariable,
	expectedDeploymentID *string,
	previewExpiry *time.Time,
) error {
	err := s.v2Pool.Transaction(ctx, func(ctx context.Context, tx Statementer[AllStatements]) error {
		stmts := tx.Statements()
		if err := stmts.LockProject(ctx, entity.ProjectID); err != nil {
			return err
		}
		if expectedDeploymentID != nil {
			newest, err := stmts.NewestDeployment(ctx, entity.ProjectID, entity.Targets[0].Origin)
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
		if err := stmts.CreateDeployment(ctx, entity); err != nil {
			return err
		}
		if values := frozen(entity.ID); len(values) > 0 {
			if err := stmts.CreateDeploymentVariables(ctx, values); err != nil {
				return err
			}
		}
		if previewExpiry != nil {
			for _, target := range entity.Targets {
				if err := stmts.UpsertPreview(ctx, &domain.Preview{
					ProjectID: entity.ProjectID,
					Origin:    target.Origin,
					ExpiresAt: *previewExpiry,
				}); err != nil {
					return err
				}
			}
		}
		return emitDeploymentCreated(ctx, stmts, entity)
	})
	if err != nil {
		if isNoRow(err) {
			return domain.ErrProjectNotFound()
		}
		if _, ok := errors.AsType[*database.ForeignKeyError](err); ok {
			return domain.ErrDeploymentInvalid("release not found in this project", err)
		}
		if de, ok := errors.AsType[domain.Error](err); ok {
			return de
		}
		return domain.ErrInternal(err).WithMessage("failed to create deployment")
	}
	return nil
}

// expandTargets turns the wire selectors into exact targets, checked against
// the project's origins. Mixing preview origins with the default or a
// primary is refused: a preview run never moves production.
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
			for _, entry := range project.Origins {
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
			matched, ok := domain.MatchOrigin(project.Origins, origin)
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

func containsOrigin(origins []string, origin string) bool {
	for _, candidate := range origins {
		if candidate == origin {
			return true
		}
	}
	return false
}

func targetLabel(origin string) string {
	if origin == "" {
		return "(default)"
	}
	return origin
}

// alreadyServing returns the deployment every target serves when it is one
// and the same, names releaseID and froze the same values, else nil.
func (s *DeploymentService) alreadyServing(ctx context.Context, projectID, releaseID string, targets []deployTarget, resolved []*domain.Variable) (*domain.Deployment, error) {
	stmts := s.v2Pool.Statements()
	var current *domain.Deployment
	for _, target := range targets {
		newest, err := stmts.NewestDeployment(ctx, projectID, target.origin)
		if err != nil {
			if isNoRow(err) {
				return nil, nil
			}
			return nil, domain.ErrInternal(err).WithMessage("failed to read the target's newest deployment")
		}
		if newest.ReleaseID != releaseID || (current != nil && newest.ID != current.ID) {
			return nil, nil
		}
		current = newest
	}
	frozen, err := stmts.GetDeploymentVariables(ctx, projectID, current.ID)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to read the deployment's variables")
	}
	if !sameFrozenValues(frozen, resolved) {
		return nil, nil
	}
	return current, nil
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

// deploymentToUndo reads the named deployment, or the project's newest one
// when deploymentID is nil.
func (s *DeploymentService) deploymentToUndo(ctx context.Context, projectID string, deploymentID *string) (*domain.Deployment, error) {
	if deploymentID != nil {
		return s.Get(ctx, projectID, *deploymentID)
	}
	// A nested read on behalf of a caller the handler already authorised.
	page, err := s.v2Pool.Statements().ListDeployments(WithAuthzListUnrestricted(ctx), deployment.ListOptions(projectID, nil, 1))
	if err != nil {
		return nil, mapListError(err, "failed to list deployments")
	}
	if len(page.Items) == 0 {
		return nil, domain.ErrDeploymentNotFound().WithMessage("the project has no deployment to roll back")
	}
	return page.Items[0], nil
}

// previousRelease finds the newest deployment of origin that names a release
// other than undone's and is not undone itself, or nil when the target has
// served nothing else.
func (s *DeploymentService) previousRelease(ctx context.Context, projectID string, undone *domain.Deployment, origin string) (*domain.Deployment, error) {
	page, err := s.v2Pool.Statements().ListDeployments(WithAuthzListUnrestricted(ctx), deployment.ListOptions(projectID, &origin, 100))
	if err != nil {
		return nil, mapListError(err, "failed to list deployments")
	}
	for _, candidate := range page.Items {
		if candidate.ID == undone.ID || candidate.ReleaseID == undone.ReleaseID {
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
		previews, err := stmts.ListPreviews(ctx, input.ProjectID)
		if err != nil {
			return nil, domain.ErrInternal(err).WithMessage("failed to list previews")
		}
		expires := make(map[string]time.Time, len(previews))
		for _, preview := range previews {
			expires[preview.Origin] = preview.ExpiresAt
		}
		for _, item := range items {
			for i := range item.Targets {
				if at, ok := expires[item.Targets[i].Origin]; ok {
					item.Targets[i].ExpiresAt = &at
				}
			}
		}
		output.Items = items
	} else {
		opts := deployment.ListOptions(input.ProjectID, input.Origin, uint32(normalizeLimit(input.Limit)))
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

// ---- Previews --------------------------------------------------------------

// ListPreviews returns the project's live previews, expired ones left out.
func (s *DeploymentService) ListPreviews(ctx context.Context, projectID string) ([]*domain.Preview, error) {
	rows, err := s.v2Pool.Statements().ListPreviews(ctx, projectID)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to list previews")
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

// RemovePreview retires one preview URL: its row goes, its deployments stay.
func (s *DeploymentService) RemovePreview(ctx context.Context, projectID, origin string) error {
	normalized, err := domain.NormalizeOrigin(origin)
	if err != nil {
		return err
	}
	if err := s.v2Pool.Statements().DeletePreview(ctx, projectID, normalized); err != nil {
		if isNoRow(err) {
			return domain.ErrPreviewNotFound()
		}
		return domain.ErrInternal(err).WithMessage("failed to delete preview")
	}
	return nil
}
