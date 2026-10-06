package service

import (
	"context"
	"strings"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
)

// RuntimeResolution is which release serves a public request, decided from
// the origin it arrived on. Target is the origin the deployment was found
// under ("" for the project default). Deployment and Release are nil only on
// a sandbox project that has deployed nothing yet, where the request falls
// back to the newest revisions.
type RuntimeResolution struct {
	Project    *domain.Project
	Target     string
	Deployment *domain.Deployment
	Release    *domain.Release
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

// Resolve walks the three layers: the gate refuses an origin the allowlist
// does not admit, the route serves the newest deployment to that exact
// origin, and the fallback serves the project default. A pin may then select
// among what was deployed to the matched target; it never activates.
func (r *RuntimeResolver) Resolve(ctx context.Context, projectID, origin, pin string) (*RuntimeResolution, error) {
	stmts := r.v2Pool.Statements()
	project, err := stmts.GetProjectByID(ctx, projectID)
	if err != nil {
		if isNoRow(err) {
			return nil, domain.ErrProjectNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to read the project")
	}
	resolution := &RuntimeResolution{Project: project}

	matched, err := r.Gate(ctx, project, origin)
	if err != nil {
		return nil, err
	}

	if matched != nil {
		dep, err := stmts.NewestDeployment(ctx, projectID, matched.origin)
		switch {
		case err == nil:
			resolution.Target = matched.origin
			resolution.Deployment = dep
		case !isNoRow(err):
			return nil, domain.ErrInternal(err).WithMessage("failed to read the origin's newest deployment")
		case matched.preview:
			return nil, domain.ErrProjectPreviewNotLive(map[string]string{"origin": matched.origin})
		}
	}
	if resolution.Deployment == nil {
		dep, err := stmts.NewestDeployment(ctx, projectID, "")
		switch {
		case err == nil:
			resolution.Deployment = dep
		case !isNoRow(err):
			return nil, domain.ErrInternal(err).WithMessage("failed to read the project default deployment")
		case project.Class == domain.ProjectClassProduction && pin == "":
			return nil, domain.ErrReleaseNoDefault()
		}
	}

	if pin = strings.TrimSpace(pin); pin != "" {
		release, err := r.releases.GetByRef(ctx, projectID, pin)
		if err != nil {
			return nil, err
		}
		if release.Revoked() {
			return nil, domain.ErrReleaseRevoked()
		}
		dep, err := stmts.NewestDeploymentOfRelease(ctx, projectID, resolution.Target, release.ID)
		switch {
		case err == nil:
			resolution.Deployment = dep
		case !isNoRow(err):
			return nil, domain.ErrInternal(err).WithMessage("failed to look up the pinned release's deployments")
		case project.Class == domain.ProjectClassProduction:
			return nil, domain.ErrReleaseNotDeployed(map[string]string{"release": pin, "target": resolution.Target})
		default:
			resolution.Deployment = nil
		}
		resolution.Release = release
		return resolution, nil
	}

	if resolution.Deployment == nil {
		return resolution, nil
	}
	release, err := r.releases.Get(ctx, projectID, resolution.Deployment.ReleaseID)
	if err != nil {
		return nil, err
	}
	if release.Revoked() {
		return nil, domain.ErrReleaseRevoked()
	}
	resolution.Release = release
	return resolution, nil
}

// matchedOrigin is an origin the gate admitted: the exact string, and
// whether it was admitted by a preview row rather than a primary pattern.
type matchedOrigin struct {
	origin  string
	preview bool
}

// Gate decides whether a request from origin may be served at all. An absent
// origin is not a browser and passes with no match. A sandbox project with an
// empty allowlist admits everything, and admits loopback regardless; a
// production project requires a pattern. A preview pattern admits nothing by
// itself: the live row for the exact URL does.
func (r *RuntimeResolver) Gate(ctx context.Context, project *domain.Project, origin string) (*matchedOrigin, error) {
	origin = strings.TrimSpace(origin)
	if origin == "" {
		return nil, nil
	}
	normalized, err := domain.NormalizeOrigin(origin)
	if err != nil {
		return nil, domain.ErrProjectOriginNotAllowed(map[string]string{"origin": origin})
	}
	entry, ok := domain.MatchAllowedOrigin(project.AllowedOrigins, normalized)
	if !ok {
		if project.Class == domain.ProjectClassSandbox && (len(project.AllowedOrigins) == 0 || domain.IsLoopbackOrigin(normalized)) {
			return &matchedOrigin{origin: normalized}, nil
		}
		return nil, domain.ErrProjectOriginNotAllowed(map[string]string{"origin": normalized})
	}
	if entry.Kind == domain.OriginKindPrimary {
		return &matchedOrigin{origin: normalized}, nil
	}
	row, err := r.v2Pool.Statements().GetOrigin(ctx, project.ID, normalized)
	if err != nil {
		if isNoRow(err) {
			return nil, domain.ErrProjectPreviewNotLive(map[string]string{"origin": normalized})
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to read the preview origin")
	}
	if row.Expired(r.now()) {
		return nil, domain.ErrProjectPreviewNotLive(map[string]string{"origin": normalized})
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
