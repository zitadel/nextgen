package service

import (
	"context"
	"errors"
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
// environment and release serve it. The environment is never chosen by the
// client: it follows from the request's Origin. The release may be pinned by
// the client (`X-Zitadel-Release`) to an id already deployed to that
// environment, which is how a frontend preview deployment selects the
// configuration release it was built against.
type RuntimeSelector struct {
	Origin  string
	Release string
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
// Environment: the Origin is matched against every unexpired preview of the
// project; no match means live. Release: an explicit selector must name a
// release of the project that has a deployment on the resolved environment;
// "latest" or no selector means the environment's current deployment.
func (r *RuntimeResolver) Resolve(ctx context.Context, projectID string, selector RuntimeSelector) (*RuntimeResolution, error) {
	stmts := r.v2Pool.Statements()
	env, source, err := r.resolveEnvironment(ctx, stmts, projectID, selector.Origin, strings.TrimSpace(selector.Release))
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

func (r *RuntimeResolver) resolveEnvironment(ctx context.Context, stmts AllStatements, projectID, origin, releaseSelector string) (*domain.Environment, RuntimeEnvironmentSource, error) {
	origin = strings.ToLower(strings.TrimSpace(origin))
	if origin != "" {
		// A project has few environments, so one page covers them; the
		// match runs in Go against the origins document of each preview.
		result, err := stmts.ListEnvironments(WithAuthzListUnrestricted(ctx), &database.ListOptions[domain.EnvironmentField]{
			Filter: database.And(
				database.Equal(database.Col(domain.EnvironmentFieldProjectID), projectID),
				database.Equal(database.Col(domain.EnvironmentFieldClass), domain.EnvironmentClassPreview.String()),
			),
			Pagination: database.Page[domain.EnvironmentField]{
				Limit: 200,
				OrderBy: database.OrderBy[domain.EnvironmentField]{
					Columns:   []database.Column[domain.EnvironmentField]{database.Col(domain.EnvironmentFieldName)},
					Direction: database.OrderAsc,
				},
			},
		})
		if err != nil {
			return nil, "", domain.ErrInternal(err).WithMessage("failed to list preview environments")
		}
		now := r.now()
		var candidates []*domain.Environment
		for _, env := range result.Items {
			if env.Expired(now) {
				continue
			}
			if env.ServesOrigin(origin) {
				candidates = append(candidates, env)
			}
		}
		switch len(candidates) {
		case 0:
		case 1:
			return candidates[0], RuntimeEnvironmentSourceOrigin, nil
		default:
			// Several previews cover this origin — a wildcard such as
			// https://*.vercel.app shared by every branch's preview. Never
			// pick one by name: the release the client pinned says which
			// preview it was built against.
			chosen, err := r.disambiguate(ctx, stmts, projectID, candidates, releaseSelector)
			if err != nil {
				return nil, "", err
			}
			return chosen, RuntimeEnvironmentSourceOrigin, nil
		}
	}
	live, err := stmts.GetEnvironmentByName(ctx, projectID, domain.LiveEnvironmentName)
	if err != nil {
		if _, ok := errors.AsType[*database.NoRowFoundError](err); ok {
			return nil, "", domain.ErrEnvironmentNotFound()
		}
		return nil, "", domain.ErrInternal(err).WithMessage("failed to read the live environment")
	}
	return live, RuntimeEnvironmentSourceDefault, nil
}

// disambiguate picks, among previews that all cover the request origin,
// the one currently running the release the client pinned. Without a
// selector, or with one that none or several of them run, the request is
// refused: silently serving one of them would hand a preview deployment
// another branch's configuration.
func (r *RuntimeResolver) disambiguate(ctx context.Context, stmts AllStatements, projectID string, candidates []*domain.Environment, releaseSelector string) (*domain.Environment, error) {
	names := make([]string, len(candidates))
	for i, env := range candidates {
		names[i] = env.Name
	}
	details := domain.EnvironmentAmbiguousDetails{Candidates: names}
	if releaseSelector == "" || releaseSelector == ReleaseSelectorLatest {
		return nil, domain.ErrEnvironmentAmbiguous(details)
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
