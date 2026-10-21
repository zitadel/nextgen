package service

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
)

// RuntimeResolution is which release serves a public request, decided from
// the origin it arrived on.
type RuntimeResolution struct {
	Project *domain.Project
	// Origin is the browser origin the gate admitted, "" when the request
	// carried none.
	Origin string
	Target string
	// Source is "origin" when a deployment to the exact origin answered, or
	// empty when resolution refused before a target was found.
	Source     string
	Deployment *domain.Deployment
	Release    *domain.Release
}

func (res *RuntimeResolution) logAttrs() []any {
	attrs := []any{
		slog.String("matched_origin", res.Origin),
		slog.String("target", res.Target),
		slog.String("source", res.Source),
	}
	if res.Deployment != nil {
		attrs = append(attrs,
			slog.String("deployment_id", res.Deployment.ID),
			slog.Time("deployed_at", res.Deployment.DeployedAt),
		)
	}
	if res.Release != nil {
		attrs = append(attrs,
			slog.String("release_id", res.Release.ID),
			slog.String("release_digest", res.Release.ContentHash),
		)
	}
	return attrs
}

// RuntimeResolver answers which release serves a public request of a project.
type RuntimeResolver struct {
	v2Pool   *DB
	releases ReleaseService
	now      func() time.Time
}

func NewRuntimeResolver(v2Pool *DB, releases ReleaseService) *RuntimeResolver {
	return &RuntimeResolver{v2Pool: v2Pool, releases: releases, now: time.Now}
}

// Resolve walks the three layers: the gate refuses an origin no pattern
// admits, the target is the newest deployment to that exact origin, and the
// release is that deployment's release unless it is revoked. There is no
// project default target and no release pin in this path.
func (r *RuntimeResolver) Resolve(ctx context.Context, projectID, origin string) (*RuntimeResolution, error) {
	logger := getLoggingContext(ctx, "runtime").With(
		slog.String("project_id", projectID),
		slog.String("origin", strings.TrimSpace(origin)),
	)
	resolution, err := r.resolve(ctx, projectID, origin)
	if err != nil {
		attrs := []any{slog.Any("error", err)}
		var de domain.Error
		if errors.As(err, &de) {
			attrs = append(attrs, slog.String("code", de.Code))
		}
		logger.Warn("runtime resolution refused", attrs...)
		return nil, err
	}
	if resolution == nil {
		logger.Info("runtime resolution deferred", slog.String("reason", "open_admission_no_deployment"))
		return nil, nil
	}
	logger.Info("runtime resolved", resolution.logAttrs()...)
	return resolution, nil
}

func (r *RuntimeResolver) resolve(ctx context.Context, projectID, origin string) (*RuntimeResolution, error) {
	stmts := r.v2Pool.Statements()
	project, err := stmts.GetProjectByID(ctx, projectID)
	if err != nil {
		if isNoRowFound(err) {
			return nil, domain.ErrProjectNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to read the project")
	}
	resolution := &RuntimeResolution{Project: project}

	matched, err := r.Gate(ctx, project, origin)
	if err != nil {
		return nil, err
	}
	if matched == nil {
		return nil, domain.ErrReleaseNotDeployed(nil).WithMessage("nothing is deployed to this origin")
	}

	resolution.Origin = matched.origin
	dep, err := r.newestDeployment(ctx, projectID, matched.origin)
	if err != nil {
		return nil, err
	}
	if dep == nil {
		// Empty allowlist and loopback admit without a stored pattern. Until the
		// project default target lands, that open admission keeps the
		// pre-resolution newest-revision path when nothing is deployed yet —
		// the same interim createFlow uses for a missing Origin header.
		// A primary/preview pattern match still refuses with rel.not_deployed.
		if matched.open {
			return nil, nil
		}
		return nil, domain.ErrReleaseNotDeployed(map[string]string{"origin": matched.origin}).
			WithMessage("nothing is deployed to " + matched.origin)
	}

	resolution.Target = matched.origin
	resolution.Source = "origin"
	resolution.Deployment = dep

	release, err := r.releases.Get(ctx, projectID, dep.ReleaseID)
	if err != nil {
		return nil, err
	}
	if release.Revoked() {
		return nil, domain.ErrReleaseRevoked()
	}
	resolution.Release = release
	return resolution, nil
}

func (r *RuntimeResolver) newestDeployment(ctx context.Context, projectID, origin string) (*domain.Deployment, error) {
	stmts := r.v2Pool.Statements()
	serving, err := stmts.GetNewestPerOrigin(ctx, projectID, []string{origin})
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to read the origin's newest deployment")
	}
	newest := domain.NewestOriginDeployment(serving)
	if newest == nil {
		return nil, nil
	}
	dep, err := stmts.GetDeploymentByID(ctx, projectID, newest.DeploymentID)
	if err != nil {
		if isNoRowFound(err) {
			return nil, nil
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to read the origin's newest deployment")
	}
	return dep, nil
}

// matchedOrigin is an origin the gate admitted: the exact string, whether it
// was admitted by a preview row rather than a primary pattern, and whether
// admission was open (empty allowlist or loopback) rather than a stored pattern.
type matchedOrigin struct {
	origin  string
	preview bool
	open    bool
}

// Gate decides whether a request from origin may be served at all. An absent
// origin is not a browser and passes with no match. An empty origin list
// admits every origin. A loopback origin is always admitted. A preview
// pattern admits nothing by itself: the preview row for the exact URL does.
func (r *RuntimeResolver) Gate(ctx context.Context, project *domain.Project, origin string) (*matchedOrigin, error) {
	origin = strings.TrimSpace(origin)
	if origin == "" {
		return nil, nil
	}
	normalized, err := domain.NormalizeOrigin(origin)
	if err != nil {
		return nil, domain.ErrProjectOriginNotAllowed(map[string]string{"origin": origin}).
			WithMessage(origin + " is not an origin of this project")
	}
	if len(project.Origins) == 0 || domain.IsLoopbackOrigin(normalized) {
		return &matchedOrigin{origin: normalized, open: true}, nil
	}
	entry, ok := domain.MatchOrigin(project.Origins, normalized)
	if !ok {
		return nil, domain.ErrProjectOriginNotAllowed(map[string]string{"origin": normalized}).
			WithMessage(normalized + " is not an origin of this project")
	}
	if entry.Kind == domain.OriginKindPrimary {
		return &matchedOrigin{origin: normalized}, nil
	}
	row, err := r.v2Pool.Statements().GetPreview(ctx, project.ID, normalized)
	if err != nil {
		if isNoRowFound(err) {
			return nil, domain.ErrProjectPreviewNotLive(map[string]string{"origin": normalized}).
				WithMessage("no live preview for " + normalized + "; run zitadel preview on this branch")
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to read the preview")
	}
	if row.Expired(r.now()) {
		return nil, domain.ErrProjectPreviewNotLive(map[string]string{"origin": normalized}).
			WithMessage("no live preview for " + normalized + "; run zitadel preview on this branch")
	}
	return &matchedOrigin{origin: normalized, preview: true}, nil
}

type runtimeResolutionKey struct{}

// WithRuntimeResolution attaches the release that serves the request, so the
// flow definition and branding resolve from what it pins rather than from
// the newest revision.
func WithRuntimeResolution(ctx context.Context, resolution *RuntimeResolution) context.Context {
	if resolution == nil {
		return ctx
	}
	return context.WithValue(ctx, runtimeResolutionKey{}, resolution)
}

// RuntimeResolutionFromContext returns the request's resolution, or nil when
// the request was not resolved.
func RuntimeResolutionFromContext(ctx context.Context) *RuntimeResolution {
	resolution, _ := ctx.Value(runtimeResolutionKey{}).(*RuntimeResolution)
	return resolution
}

// ReleaseFromContext is the release the request resolved to, nil when there
// is none.
func ReleaseFromContext(ctx context.Context) *domain.Release {
	resolution := RuntimeResolutionFromContext(ctx)
	if resolution == nil {
		return nil
	}
	return resolution.Release
}

// WithRelease attaches a release already known from sealed flow state, for
// the steps after the first.
func WithRelease(ctx context.Context, release *domain.Release) context.Context {
	if release == nil {
		return ctx
	}
	return WithRuntimeResolution(ctx, &RuntimeResolution{Release: release})
}

// PinnedRevisions returns the revision ids a release pins for one kind,
// keyed by handle.
func PinnedRevisions(release *domain.Release, kind domain.ReleasePointerKind) map[string]string {
	pinned := make(map[string]string)
	if release == nil {
		return pinned
	}
	for _, pointer := range release.Pointers {
		if pointer.Kind == kind {
			pinned[pointer.Handle] = pointer.RevisionID
		}
	}
	return pinned
}
