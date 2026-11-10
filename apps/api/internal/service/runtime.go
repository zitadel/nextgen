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
	// request is served the newest primary deployment.
	Target string
	// Source is "origin" when a deployment to the exact origin answered, or
	// "default" when the newest primary deployment did.
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
	// that does not list one is served the newest primary deployment when
	// opening a flow.
	ownOrigins []string
	now        func() time.Time
}

// NewRuntimeResolver builds the resolver. ownOrigins are the origins the
// deployment's console runs on, normalized here as a request's origin is;
// one that is blank or not an origin names none.
func NewRuntimeResolver(v2Pool *DB, releases ReleaseService, ownOrigins ...string) *RuntimeResolver {
	var origins []string
	for _, origin := range ownOrigins {
		normalized, err := domain.NormalizeOrigin(origin)
		if err == nil && !slices.Contains(origins, normalized) {
			origins = append(origins, normalized)
		}
	}
	return &RuntimeResolver{v2Pool: v2Pool, releases: releases, ownOrigins: origins, now: time.Now}
}

// Resolve walks the three layers: the gate refuses an origin no pattern
// admits, the target is the deployment the live view says that origin serves,
// and the release is that deployment's release unless it is revoked. A request
// with no origin, and one from a console host the project does not list, is
// served the newest primary deployment.
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

// ResolvePrimary serves the project's newest primary deployment, whatever
// origin the caller sent. Management calls that act on the project's live
// rules use it.
func (r *RuntimeResolver) ResolvePrimary(ctx context.Context, projectID string) (*RuntimeResolution, error) {
	return r.Resolve(ctx, projectID, "")
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
	// The console's own origin, where the project lists none, is served the
	// default; every other admitted origin its own target.
	if matched.pattern == "" && r.isOwnOrigin(matched.origin) {
		return r.resolutionForDefault(ctx, project, matched.origin)
	}

	dep, err := r.deploymentOf(ctx, projectID, matched)
	if err != nil {
		return nil, err
	}
	if dep != nil {
		return r.finish(ctx, project, matched.origin, matched.pattern, "origin", dep)
	}
	message := "nothing is deployed to " + matched.origin + "; run zitadel deploy"
	if matched.pattern == "" {
		// A loopback origin the project does not list: no deployment can name
		// it until it is a primary origin.
		message = "nothing is deployed to " + matched.origin + "; add it with zitadel origin add " +
			matched.origin + " --kind primary, then run zitadel deploy"
	}
	return nil, domain.ErrReleaseNotDeployed(map[string]string{"origin": matched.origin}).
		WithMessage(message)
}

// resolutionForDefault serves the project's newest primary deployment.
func (r *RuntimeResolver) resolutionForDefault(ctx context.Context, project *domain.Project, requestOrigin string) (*RuntimeResolution, error) {
	dep, err := newestPrimary(ctx, r.v2Pool.Statements(), project.ID)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to read the newest primary deployment")
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

// deploymentOf is the deployment an admitted origin serves, nil for none, as
// the live view picks it: a listed primary origin runs the newest primary
// deployment when that names it, a preview URL its live preview deployment.
// A deployment freezes its origins, so one added later waits for the next
// deploy.
func (r *RuntimeResolver) deploymentOf(ctx context.Context, projectID string, matched *matchedOrigin) (*domain.Deployment, error) {
	dep, err := r.v2Pool.Statements().GetLiveDeployment(ctx, projectID, matched.origin, r.now())
	if err != nil {
		if isNoRowFound(err) {
			return nil, nil
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to read the origin's deployment")
	}
	return dep, nil
}

// matchedOrigin is an origin the gate admitted: the normalized request
// origin and the project origin pattern that matched it, empty when the
// project lists none.
type matchedOrigin struct {
	origin  string
	pattern string
}

// gateOpening is Gate for the request that opens an attempt, which also
// opens an origin of the deployment's console where the project's origins
// refuse it: the console previews a project's login from there with the
// project's own flow. A project that admits that origin itself keeps its own
// rules there, deployments and previews included. Only the opening takes
// this exemption; every later step answers to Gate alone, so that origin can
// show a project's first step but never sign anyone in.
func (r *RuntimeResolver) gateOpening(ctx context.Context, project *domain.Project, origin string) (*matchedOrigin, error) {
	matched, err := r.Gate(ctx, project, origin)
	if err == nil {
		return matched, nil
	}
	if !r.isOwnOrigin(origin) || !errors.Is(err, domain.ErrProjectOriginNotAllowed(nil)) {
		return nil, err
	}
	normalized, normErr := domain.NormalizeOrigin(strings.TrimSpace(origin))
	if normErr != nil {
		return nil, err
	}
	return &matchedOrigin{origin: normalized}, nil
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
// admits nothing. A loopback origin is always admitted, with the pattern that
// lists it if any. A preview pattern admits nothing else by itself: the
// preview row for the exact URL does.
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
	entry, ok := domain.MatchOrigin(project.Origins, normalized)
	if domain.IsLoopbackOrigin(normalized) {
		if ok {
			return &matchedOrigin{origin: normalized, pattern: entry.Pattern}, nil
		}
		return &matchedOrigin{origin: normalized}, nil
	}
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
	return &matchedOrigin{origin: normalized, pattern: entry.Pattern}, nil
}

type runtimeResolutionKey struct{}

// WithRuntimeResolution attaches the release that serves the request.
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

// runtimePins is what the request's release pins of one kind, by handle. A
// request with no release is not deployed.
func runtimePins(ctx context.Context, kind domain.ReleasePointerKind) (domain.ReleasePins, error) {
	resolution := RuntimeResolutionFromContext(ctx)
	if resolution == nil || resolution.Release == nil {
		return nil, domain.ErrReleaseNotDeployed(nil)
	}
	return resolution.Release.Pins(kind), nil
}
