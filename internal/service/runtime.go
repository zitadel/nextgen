package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
)

// RuntimeResolution is which release serves a public request, decided from
// the origin it arrived on.
type RuntimeResolution struct {
	Project *domain.Project
	// Origin is the normalized request Origin the gate admitted, "" when the
	// request carried none.
	Origin string
	// Target is the project origin pattern that admitted Origin, "" when the
	// request is served by the default target.
	Target string
	// Source is "origin" when a deployment to the exact origin answered, or
	// "default" when the default target did.
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
	// ownOrigins are the deployment's console hosts, normalized. A project
	// that does not list one is served the default target when opening a flow.
	ownOrigins []string
	now        func() time.Time
}

// NewRuntimeResolver builds the resolver. ownOrigins are the origins the
// deployment's console runs on; an empty list names none.
func NewRuntimeResolver(v2Pool *DB, releases ReleaseService, ownOrigins ...string) *RuntimeResolver {
	seen := make(map[string]struct{}, len(ownOrigins))
	var origins []string
	for _, origin := range ownOrigins {
		origin = strings.TrimSpace(origin)
		if origin == "" {
			continue
		}
		if _, ok := seen[origin]; ok {
			continue
		}
		seen[origin] = struct{}{}
		origins = append(origins, origin)
	}
	return &RuntimeResolver{v2Pool: v2Pool, releases: releases, ownOrigins: origins, now: time.Now}
}

// Resolve walks the three layers: the gate refuses an origin no pattern
// admits, the target is the newest deployment to that exact origin, and the
// release is that deployment's release unless it is revoked. A request with
// no origin, and one from a console host the project does not list, is served
// the default target.
func (r *RuntimeResolver) Resolve(ctx context.Context, projectID, origin string) (*RuntimeResolution, error) {
	logger := getLoggingContext(ctx, "runtime").With(
		slog.String("project_id", projectID),
		slog.String("origin", strings.TrimSpace(origin)),
	)
	resolution, err := r.resolve(ctx, projectID, origin)
	if err != nil {
		// The parent carries project and origin to the boundary line, which logs
		// the refusal once. The Origin captured where the error was made stays.
		if de, ok := errors.AsType[domain.Error](err); ok {
			where := fmt.Sprintf("project %s, origin %q", projectID, strings.TrimSpace(origin))
			if de.Parent == nil {
				de.Parent = errors.New(where)
			} else {
				de.Parent = fmt.Errorf("%s: %w", where, de.Parent)
			}
			return nil, de
		}
		return nil, err
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
	origin = strings.TrimSpace(origin)
	if origin == "" {
		return r.resolutionForDefault(ctx, project, "")
	}

	matched, err := r.gateOpening(ctx, project, origin)
	if err != nil {
		return nil, err
	}

	dep, err := r.newestDeployment(ctx, projectID, matched.origin)
	if err != nil {
		return nil, err
	}
	if dep != nil {
		return r.finish(ctx, project, matched.origin, matched.pattern, "origin", dep)
	}
	if matched.miss == missDefault {
		return r.resolutionForDefault(ctx, project, matched.origin)
	}
	return nil, domain.ErrReleaseNotDeployed(map[string]string{"origin": matched.origin}).
		WithMessage("nothing is deployed to " + matched.origin)
}

func (r *RuntimeResolver) resolutionForDefault(ctx context.Context, project *domain.Project, requestOrigin string) (*RuntimeResolution, error) {
	dep, err := r.newestDeployment(ctx, project.ID, domain.DefaultTargetOrigin)
	if err != nil {
		return nil, err
	}
	if dep == nil {
		return nil, domain.ErrReleaseNoDefault()
	}
	return r.finish(ctx, project, requestOrigin, "", "default", dep)
}

func (r *RuntimeResolver) finish(ctx context.Context, project *domain.Project, origin, target, source string, dep *domain.Deployment) (*RuntimeResolution, error) {
	release, err := r.releases.Get(ctx, project.ID, dep.ReleaseID)
	if err != nil {
		return nil, err
	}
	if release.Revoked() {
		return nil, domain.ErrReleaseRevoked()
	}
	return &RuntimeResolution{
		Project:    project,
		Origin:     origin,
		Target:     target,
		Source:     source,
		Deployment: dep,
		Release:    release,
	}, nil
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

// missKind is what an admitted origin answers when nothing is deployed to it.
type missKind uint8

const (
	// missNotDeployed is a listed origin, a loopback origin, or a live preview.
	missNotDeployed missKind = iota
	// missDefault is a console host the project does not list.
	missDefault
)

// matchedOrigin is an origin the gate admitted: the normalized request
// origin, the project origin pattern that matched it (empty when the
// admission was not a stored pattern), and whether a preview row admitted it.
type matchedOrigin struct {
	origin  string
	pattern string
	preview bool
	miss    missKind
}

// gateOpening is Gate for the request that opens an attempt, which also
// opens a console host where the project's origins refuse it: the console
// previews a project's login from there with the project's own flow. A
// project that admits that origin itself keeps its own rules there,
// deployments and previews included. Only the opening takes this exemption;
// every later step answers to Gate alone, so that origin can show a project's
// first step but never sign anyone in.
func (r *RuntimeResolver) gateOpening(ctx context.Context, project *domain.Project, origin string) (*matchedOrigin, error) {
	matched, err := r.Gate(ctx, project, origin)
	if err == nil {
		if matched == nil {
			return &matchedOrigin{miss: missDefault}, nil
		}
		return matched, nil
	}
	if !r.isOwnOrigin(origin) || !errors.Is(err, domain.ErrProjectOriginNotAllowed(nil)) {
		return nil, err
	}
	normalized, normErr := domain.NormalizeOrigin(strings.TrimSpace(origin))
	if normErr != nil {
		return nil, err
	}
	return &matchedOrigin{origin: normalized, miss: missDefault}, nil
}

func (r *RuntimeResolver) isOwnOrigin(origin string) bool {
	if len(r.ownOrigins) == 0 {
		return false
	}
	normalized, err := domain.NormalizeOrigin(strings.TrimSpace(origin))
	if err != nil {
		return false
	}
	return slices.Contains(r.ownOrigins, normalized)
}

// Gate decides whether a request from origin may be served at all. An absent
// origin is not a browser and passes with no match. An empty origin list
// admits nothing. A loopback origin is always admitted. A preview pattern
// admits nothing by itself: the preview row for the exact URL does.
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
	if domain.IsLoopbackOrigin(normalized) {
		return &matchedOrigin{origin: normalized}, nil
	}
	entry, ok := domain.MatchOrigin(project.Origins, normalized)
	if !ok {
		return nil, domain.ErrProjectOriginNotAllowed(map[string]string{"origin": normalized}).
			WithMessage(normalized + " is not an origin of this project")
	}
	if entry.Kind == domain.OriginKindPrimary {
		return &matchedOrigin{origin: normalized, pattern: entry.Pattern}, nil
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
	return &matchedOrigin{origin: normalized, pattern: entry.Pattern, preview: true}, nil
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

// PinnedRevisions is handle → revision id for one release pointer kind.
type PinnedRevisions map[string]string

// runtimePins is the revision set a serving request may read. A request with
// no release is not deployed; PinsFor stays the pure map for a release the
// caller already holds.
func runtimePins(ctx context.Context, kind domain.ReleasePointerKind) (PinnedRevisions, error) {
	release := ReleaseFromContext(ctx)
	if release == nil {
		return nil, domain.ErrReleaseNotDeployed(nil)
	}
	return PinsFor(release, kind), nil
}

// PinsFor returns the revision ids a release pins for one kind, keyed by handle.
func PinsFor(release *domain.Release, kind domain.ReleasePointerKind) PinnedRevisions {
	pinned := make(PinnedRevisions)
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
