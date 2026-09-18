package service

import (
	"context"
	"errors"
	"slices"
	"strings"
	"time"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/storage/database"
	"github.com/zitadel/nextgen/internal/storage/deployment"
)

// ReleaseSelectorLatest is the release selector meaning "whatever the
// resolved environment currently runs". Absent selector means the same.
const ReleaseSelectorLatest = "latest"

// RuntimeSelector is what a public request carries that decides which
// environment and release serve it. The environment follows from the
// request's Origin unless the client names one (`X-Zitadel-Environment`),
// which is how a frontend preview deployment selects the preview it was
// built for. The release may be pinned on top (`X-Zitadel-Release`) to an
// id already deployed to that environment.
type RuntimeSelector struct {
	Origin      string
	Environment string
	Release     string
}

// RuntimeResolution is the answer: the environment the request belongs to,
// and the release that environment serves it with. Deployment and Release
// are nil when the environment has nothing deployed yet, in which case the
// runtime falls back to the newest revisions of every resource.
type RuntimeResolution struct {
	Environment       *domain.Environment
	EnvironmentSource RuntimeEnvironmentSource
	Deployment        *domain.Deployment
	Release           *domain.Release
	ReleaseSource     RuntimeReleaseSource
}

type RuntimeEnvironmentSource string

const (
	// RuntimeEnvironmentSourceSelector: the client named the environment.
	RuntimeEnvironmentSourceSelector RuntimeEnvironmentSource = "selector"
	// RuntimeEnvironmentSourceOrigin: the request's Origin matched a
	// preview environment's origins.
	RuntimeEnvironmentSourceOrigin RuntimeEnvironmentSource = "origin"
	// RuntimeEnvironmentSourceDefault: nothing matched, live serves it.
	RuntimeEnvironmentSourceDefault RuntimeEnvironmentSource = "default"
)

type RuntimeReleaseSource string

const (
	// RuntimeReleaseSourceSelector: the client pinned a release id.
	RuntimeReleaseSourceSelector RuntimeReleaseSource = "selector"
	// RuntimeReleaseSourceCurrent: the environment's current deployment.
	RuntimeReleaseSourceCurrent RuntimeReleaseSource = "current"
	// RuntimeReleaseSourceNone: the environment has no deployment yet.
	RuntimeReleaseSourceNone RuntimeReleaseSource = "none"
)

// ErrRuntimeReleaseNotDeployed reports a pinned release that exists but was
// never deployed to the resolved environment, so it cannot serve requests
// arriving there.
func ErrRuntimeReleaseNotDeployed(details any) domain.Error {
	return domain.ErrReleaseInvalid(details, nil).WithMessage("the selected release is not deployed to this environment")
}

// RuntimeResolver answers which environment and release serve a public
// request of a project.
type RuntimeResolver struct {
	v2Pool *DB
	now    func() time.Time
}

func NewRuntimeResolver(v2Pool *DB) *RuntimeResolver {
	return &RuntimeResolver{v2Pool: v2Pool, now: time.Now}
}

// Resolve walks request -> environment -> deployment -> release.
//
// Environment: an explicit selector names one of the project's environments
// (a preview must not have expired). Otherwise the Origin is matched against
// every unexpired preview of the project; no match means live. Release: an
// explicit selector must name a release of the project that has a deployment
// on the resolved environment; "latest" or no selector means the
// environment's current deployment.
func (r *RuntimeResolver) Resolve(ctx context.Context, projectID string, selector RuntimeSelector) (*RuntimeResolution, error) {
	stmts := r.v2Pool.Statements()
	if err := r.checkOriginAllowed(ctx, stmts, projectID, selector.Origin); err != nil {
		return nil, err
	}
	var (
		env    *domain.Environment
		source RuntimeEnvironmentSource
		err    error
	)
	if name := strings.TrimSpace(selector.Environment); name != "" {
		env, err = r.selectEnvironment(ctx, stmts, projectID, name, selector.Origin)
		source = RuntimeEnvironmentSourceSelector
	} else {
		env, source, err = r.resolveEnvironment(ctx, stmts, projectID, selector.Origin, strings.TrimSpace(selector.Release))
	}
	if err != nil {
		return nil, err
	}
	resolution := &RuntimeResolution{
		Environment:       env,
		EnvironmentSource: source,
		ReleaseSource:     RuntimeReleaseSourceNone,
	}

	selected := strings.TrimSpace(selector.Release)
	if selected == "" || selected == ReleaseSelectorLatest {
		if env.CurrentDeploymentID == nil {
			return resolution, nil
		}
		dep, err := stmts.GetDeploymentByID(ctx, projectID, *env.CurrentDeploymentID)
		if err != nil {
			return nil, domain.ErrInternal(err).WithMessage("failed to read the environment's current deployment")
		}
		release, err := stmts.GetReleaseByID(ctx, projectID, dep.ReleaseID)
		if err != nil {
			return nil, domain.ErrInternal(err).WithMessage("failed to read the environment's current release")
		}
		resolution.Deployment = dep
		resolution.Release = release
		resolution.ReleaseSource = RuntimeReleaseSourceCurrent
		return resolution, nil
	}

	release, err := stmts.GetReleaseByID(ctx, projectID, selected)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrReleaseNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to read the selected release")
	}
	dep, err := r.deploymentOf(ctx, stmts, projectID, env.ID, release.ID)
	if err != nil {
		return nil, err
	}
	if dep == nil {
		return nil, ErrRuntimeReleaseNotDeployed(map[string]string{
			"release_id":  release.ID,
			"environment": env.Name,
		})
	}
	resolution.Deployment = dep
	resolution.Release = release
	resolution.ReleaseSource = RuntimeReleaseSourceSelector
	return resolution, nil
}

// checkOriginAllowed refuses a browser request whose Origin the project's
// allowlist does not cover. The allowlist is the union of every
// environment's issuer and issuer_pattern in zitadel.json, so an origin
// missing there is a deployment nobody declared. An empty allowlist allows
// every origin (development and tests), and a request without an Origin
// (server to server, curl) is not a browser and is not gated here.
func (r *RuntimeResolver) checkOriginAllowed(ctx context.Context, stmts AllStatements, projectID, origin string) error {
	origin = strings.ToLower(strings.TrimSpace(origin))
	if origin == "" {
		return nil
	}
	project, err := stmts.GetProjectByID(ctx, projectID)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return domain.ErrProjectNotFound()
		}
		return domain.ErrInternal(err).WithMessage("failed to read the project for its origin allowlist")
	}
	if len(project.PreviewOrigins) == 0 || domain.MatchAnyOrigin(project.PreviewOrigins, origin) {
		return nil
	}
	return domain.ErrProjectOriginNotAllowed(map[string]any{
		"origin":  origin,
		"allowed": project.PreviewOrigins,
	})
}

// selectEnvironment answers a request that names its environment. The name
// must be one of the project's environments; an expired preview is refused
// rather than silently served by live, so a stale deployment fails loudly.
// The environment must also serve the request origin: naming it settles
// which of several candidates on a shared pattern the request means, it
// never widens where the environment can be reached from, so a production
// deployment cannot be pointed at a preview. Live with no origins registered
// serves every origin, as it does when nothing names it; a request without
// an origin (server to server) is not gated.
func (r *RuntimeResolver) selectEnvironment(ctx context.Context, stmts AllStatements, projectID, name, origin string) (*domain.Environment, error) {
	env, err := stmts.GetEnvironmentByName(ctx, projectID, name)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, domain.ErrEnvironmentNotFound()
		}
		return nil, domain.ErrInternal(err).WithMessage("failed to read the selected environment")
	}
	if env.Expired(r.now()) {
		return nil, domain.ErrEnvironmentExpired()
	}
	origin = strings.ToLower(strings.TrimSpace(origin))
	servesAll := env.Class == domain.EnvironmentClassLive && len(env.Origins) == 0
	if origin != "" && !servesAll && !env.ServesOrigin(origin) {
		return nil, domain.ErrEnvironmentOriginNotServed(domain.EnvironmentOriginNotServedDetails{
			Environment: env.Name,
			Origin:      origin,
			Origins:     env.Origins,
		})
	}
	return env, nil
}

// resolveEnvironment picks the environment for an origin. An environment
// whose origins name the origin literally wins over one that only covers it
// by wildcard, so production at https://app.vercel.app (registered on live
// by `zitadel deploy`) is not swallowed by the previews' https://*.vercel.app.
// Live takes part in the exact tier only; with no match at all it serves the
// request as the default.
func (r *RuntimeResolver) resolveEnvironment(ctx context.Context, stmts AllStatements, projectID, origin, releaseSelector string) (*domain.Environment, RuntimeEnvironmentSource, error) {
	origin = strings.ToLower(strings.TrimSpace(origin))
	// A project has few environments, so one page covers them; the match
	// runs in Go against the origins document of each row.
	result, err := stmts.ListEnvironments(WithAuthzListUnrestricted(ctx), &database.ListOptions[domain.EnvironmentField]{
		Filter: database.Equal(database.Col(domain.EnvironmentFieldProjectID), projectID),
		Pagination: database.Page[domain.EnvironmentField]{
			Limit: 200,
			OrderBy: database.OrderBy[domain.EnvironmentField]{
				Columns:   []database.Column[domain.EnvironmentField]{database.Col(domain.EnvironmentFieldName)},
				Direction: database.OrderAsc,
			},
		},
	})
	if err != nil {
		return nil, "", domain.ErrInternal(err).WithMessage("failed to list environments")
	}
	var live *domain.Environment
	var exact, wildcard []*domain.Environment
	now := r.now()
	for _, env := range result.Items {
		if env.Class == domain.EnvironmentClassLive {
			live = env
		}
		if origin == "" || env.Expired(now) {
			continue
		}
		switch {
		case slices.Contains(env.Origins, origin):
			exact = append(exact, env)
		case env.Class == domain.EnvironmentClassPreview && env.ServesOrigin(origin):
			wildcard = append(wildcard, env)
		}
	}
	switch len(exact) {
	case 0:
	case 1:
		return exact[0], RuntimeEnvironmentSourceOrigin, nil
	default:
		// Two environments naming the same origin literally is a
		// configuration clash; the pinned release still settles it.
		chosen, err := r.disambiguate(ctx, stmts, projectID, exact, releaseSelector)
		if err != nil {
			return nil, "", err
		}
		return chosen, RuntimeEnvironmentSourceOrigin, nil
	}
	if len(wildcard) > 0 {
		// A wildcard such as https://*.vercel.app is shared by every
		// branch's preview, and which previews exist changes by the hour.
		// A deployment reached through one must say which release it was
		// built against — even while it happens to be the only candidate,
		// so that the next branch's preview does not change what it gets.
		chosen, err := r.disambiguate(ctx, stmts, projectID, wildcard, releaseSelector)
		if err != nil {
			return nil, "", err
		}
		return chosen, RuntimeEnvironmentSourceOrigin, nil
	}
	if live == nil {
		return nil, "", domain.ErrEnvironmentNotFound()
	}
	return live, RuntimeEnvironmentSourceDefault, nil
}

// disambiguate picks, among previews that cover the request origin, the
// one currently running the release the client pinned. Without a selector
// the request is refused (env.release_required); with one that none or
// several of them run it is refused too (env.ambiguous). Silently serving
// one of them would hand a preview deployment another branch's
// configuration.
func (r *RuntimeResolver) disambiguate(ctx context.Context, stmts AllStatements, projectID string, candidates []*domain.Environment, releaseSelector string) (*domain.Environment, error) {
	names := make([]string, len(candidates))
	for i, env := range candidates {
		names[i] = env.Name
	}
	details := domain.EnvironmentAmbiguousDetails{Candidates: names}
	if releaseSelector == "" || releaseSelector == ReleaseSelectorLatest {
		return nil, domain.ErrEnvironmentReleaseRequired(details)
	}
	var matches []*domain.Environment
	for _, env := range candidates {
		if env.CurrentDeploymentID == nil {
			continue
		}
		dep, err := stmts.GetDeploymentByID(ctx, projectID, *env.CurrentDeploymentID)
		if err != nil {
			return nil, domain.ErrInternal(err).WithMessage("failed to read a preview's current deployment")
		}
		if dep.ReleaseID == releaseSelector {
			matches = append(matches, env)
		}
	}
	if len(matches) != 1 {
		details.ReleaseID = releaseSelector
		return nil, domain.ErrEnvironmentAmbiguous(details)
	}
	return matches[0], nil
}

// deploymentOf finds the newest deployment of releaseID on environmentID,
// or nil when the release was never deployed there.
func (r *RuntimeResolver) deploymentOf(ctx context.Context, stmts AllStatements, projectID, environmentID, releaseID string) (*domain.Deployment, error) {
	result, err := stmts.ListDeployments(WithAuthzListUnrestricted(ctx), &database.ListOptions[domain.DeploymentField]{
		Filter: database.And(
			database.Equal(database.Col(domain.DeploymentFieldProjectID), projectID),
			database.Equal(database.Col(domain.DeploymentFieldEnvironmentID), environmentID),
			database.Equal(database.Col(domain.DeploymentFieldReleaseID), releaseID),
		),
		Pagination: database.Page[domain.DeploymentField]{
			Limit:   1,
			OrderBy: deployment.NewestFirst(),
		},
	})
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to look up the release's deployments")
	}
	if len(result.Items) == 0 {
		return nil, nil
	}
	return result.Items[0], nil
}
