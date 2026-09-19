package api

import (
	"log/slog"

	ogenmw "github.com/ogen-go/ogen/middleware"

	oasapi "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/api/middleware"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
	"github.com/zitadel/nextgen/internal/service"
)

// Environment and release resolution (ADR 035, environments discovery).
//
// Every public request of a project is served by exactly one environment and
// one configuration release. The environment is the one the client names
// with X-Zitadel-Environment (a frontend preview deployment names the
// preview it was built for) or, without it, follows from the request's
// Origin: a preview environment claims the origins of the frontend preview
// deployments built for it, and live serves every origin no preview claims.
// The release is the environment's current deployment unless the client pins
// one with X-Zitadel-Release, which must already be deployed to that
// environment.
//
// The project a request belongs to arrives in decoded input (the body of
// POST /flow), so this is an ogen middleware rather than an http.Handler
// one: it runs after ogen decoded parameters and body, and before the
// handler. Handlers never resolve themselves; they read the answer from the
// context (service.RuntimeResolutionFromContext), and so do the services
// down the call chain (flow definition and branding pin to the release).
// It lives here rather than in internal/api/middleware because it calls
// the service layer, and that package is a leaf the service layer's own
// dependencies (audit) import.
//
// Wired for POST /flow today. Every other public endpoint that reads project
// configuration has to resolve the same way before configuration stops
// being "the newest revision"; they are listed here rather than wired, so
// the prototype keeps one resolution point:
//
//   - POST /sessions/exchange: the schema revision the session's user was
//     created against.
//   - GET /sessions/me and the /users/me family: user schema for rendering.
//   - pivots inside a running flow (child definitions by name) still resolve
//     the newest revision rather than the sealed release's.
//   - the console runtime document (/console/runtime.json).

const (
	environmentSelectorHeader = "X-Zitadel-Environment"
	releaseSelectorHeader     = "X-Zitadel-Release"
)

// WithRuntimeResolution resolves the environment and release that serve a
// public request and puts the resolution on the request context. Operations
// whose project is not known from their decoded input pass through
// unresolved. A failed resolution ends the request with the domain error
// (origin not allowed, environment not found, release not deployed, ...).
func WithRuntimeResolution(resolver *service.RuntimeResolver) oasapi.Middleware {
	return func(req ogenmw.Request, next ogenmw.Next) (ogenmw.Response, error) {
		projectID, ok := runtimeProjectID(req)
		if !ok {
			return next(req)
		}
		selector := service.RuntimeSelector{
			Origin:      middleware.RequestOrigin(req.Raw),
			Environment: headerParam(req, environmentSelectorHeader),
			Release:     headerParam(req, releaseSelectorHeader),
		}
		resolution, err := resolver.Resolve(req.Context, projectID, selector)
		logger := zlog.GetLoggingContext(req.Context).With(
			slog.String("project_id", projectID),
			slog.String("origin", selector.Origin),
			slog.String("environment_selector", selector.Environment),
			slog.String("release_selector", selector.Release),
		)
		if err != nil {
			logger.Warn("runtime resolution failed", slog.Any("error", err))
			return ogenmw.Response{}, err
		}
		attrs := []any{
			slog.String("environment", resolution.Environment.Name),
			slog.String("environment_id", resolution.Environment.ID),
			slog.String("environment_class", resolution.Environment.Class.String()),
			slog.String("environment_source", string(resolution.EnvironmentSource)),
			slog.String("release_source", string(resolution.ReleaseSource)),
		}
		if resolution.Release != nil {
			attrs = append(attrs,
				slog.String("release_id", resolution.Release.ID),
				slog.String("deployment_id", resolution.Deployment.ID),
			)
		}
		logger.Info("resolved runtime environment and release", attrs...)
		req.SetContext(service.WithRuntimeResolution(req.Context, resolution))
		return next(req)
	}
}

// runtimeProjectID is the project a public operation belongs to, read from
// its decoded input. One case per wired operation.
func runtimeProjectID(req ogenmw.Request) (string, bool) {
	switch body := req.Body.(type) {
	case *oasapi.CreateFlowRequest:
		return string(body.ProjectID), body.ProjectID != ""
	}
	return "", false
}

// headerParam is the value of an optional string header parameter of the
// operation, empty when the operation does not declare it or the client did
// not send it.
func headerParam(req ogenmw.Request, name string) string {
	value, ok := req.Params[ogenmw.ParameterKey{Name: name, In: "header"}]
	if !ok {
		return ""
	}
	switch v := value.(type) {
	case oasapi.OptString:
		return v.Or("")
	case string:
		return v
	}
	return ""
}
