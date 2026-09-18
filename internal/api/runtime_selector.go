package api

import (
	"context"
	"log/slog"
	"net/http"
	"net/url"
	"strings"

	oasapi "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/instrumentation/zlog"
	"github.com/zitadel/nextgen/internal/service"
)

// Environment and release resolution (ADR 035, environments discovery).
//
// Every public request of a project is served by exactly one environment and
// one configuration release. The environment follows from the request's
// Origin: a preview environment claims the origins of the frontend preview
// deployments built for it, and live serves every origin no preview claims.
// The release is the environment's current deployment unless the client pins
// one with X-Zitadel-Release, which must already be deployed to that
// environment.
//
// WithRuntimeSelectorMiddleware records the request origin for the handlers;
// the resolution itself happens once the project is known, inside the
// handler, because the project id arrives in the request body.
//
// Wired into POST /flow today. Every other public endpoint that reads
// project configuration has to resolve the same way before configuration
// stops being "the newest revision"; they are listed here rather than wired,
// so the prototype keeps one resolution point:
//
//   - POST /flow/{id}/submit and GET /flow/{id}: the flow's revisions are
//     pinned in the sealed state at start, so these keep serving the release
//     the flow started on (ADR 035: an in-flight attempt stays bound).
//   - POST /sessions/exchange: the schema revision the session's user was
//     created against.
//   - GET /sessions/me and the /users/me family: user schema for rendering.
//   - branding reads inside flow responses (resolveBranding): today the
//     newest branding revision, tomorrow the release's branding pointer.
//   - the console runtime document (/console/runtime.json).

type runtimeOriginKey struct{}

// WithRuntimeSelectorMiddleware records the request's origin, taken from the
// Origin header or, failing that, the origin of the Referer, so handlers can
// resolve the environment a public request belongs to.
func WithRuntimeSelectorMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := requestOrigin(r)
		if origin != "" {
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), runtimeOriginKey{}, origin)))
			return
		}
		next.ServeHTTP(w, r)
	})
}

func requestOrigin(r *http.Request) string {
	if origin := strings.TrimSpace(r.Header.Get("Origin")); origin != "" && origin != "null" {
		return strings.ToLower(origin)
	}
	referer := strings.TrimSpace(r.Header.Get("Referer"))
	if referer == "" {
		return ""
	}
	u, err := url.Parse(referer)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return ""
	}
	return strings.ToLower(u.Scheme + "://" + u.Host)
}

func runtimeOriginFromContext(ctx context.Context) string {
	v, _ := ctx.Value(runtimeOriginKey{}).(string)
	return v
}

// WithRuntimeResolver wires the environment and release resolver. A
// chainable setter rather than a constructor parameter so the existing
// NewHandler call sites stay untouched; without it, public requests skip
// resolution and are served the newest revisions as before.
func (h *Handler) WithRuntimeResolver(r *service.RuntimeResolver) *Handler {
	h.runtimeResolver = r
	return h
}

// resolveRuntime answers which environment and release serve this request
// and logs the answer. Nil resolution means the resolver is not wired.
func (h *Handler) resolveRuntime(ctx context.Context, projectID string, releaseSelector oasapi.OptString) (*service.RuntimeResolution, error) {
	if h.runtimeResolver == nil {
		return nil, nil
	}
	selector := service.RuntimeSelector{
		Origin:  runtimeOriginFromContext(ctx),
		Release: releaseSelector.Or(""),
	}
	resolution, err := h.runtimeResolver.Resolve(ctx, projectID, selector)
	logger := zlog.GetLoggingContext(ctx).With(
		slog.String("project_id", projectID),
		slog.String("origin", selector.Origin),
		slog.String("release_selector", selector.Release),
	)
	if err != nil {
		logger.Warn("runtime resolution failed", slog.Any("error", err))
		return nil, err
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
	return resolution, nil
}
