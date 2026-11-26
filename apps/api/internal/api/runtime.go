package api

import (
	"context"

	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/audit"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// resolveRuntime decides which release serves a request from Origin and the
// release it pins, if any, and puts the answer on the context.
func (h *Handler) resolveRuntime(ctx context.Context, projectID, origin, releaseID string) (context.Context, error) {
	if h.runtime == nil {
		return ctx, nil
	}
	resolution, err := h.runtime.ResolvePinned(ctx, projectID, origin, releaseID)
	if err != nil {
		return ctx, err
	}
	return service.WithRuntimeResolution(bindRuntime(ctx, resolution), resolution), nil
}

// bindRuntime records the resolved deployment on the request's events.
func bindRuntime(ctx context.Context, resolution *service.RuntimeResolution) context.Context {
	if resolution == nil || resolution.Deployment == nil {
		return ctx
	}
	runtime := audit.Runtime{DeploymentID: resolution.Deployment.ID, Target: resolution.Origin}
	if resolution.Release != nil {
		runtime.ReleaseID = resolution.Release.ID
	}
	return audit.BindRuntime(ctx, runtime)
}

// releasePin reads the X-Zitadel-Release header: the release id it pins, ""
// when the request pins none.
func releasePin(header api.OptString) (string, error) {
	value, ok := header.Get()
	if !ok {
		return "", nil
	}
	return domain.ParseReleaseReference(value)
}

// resolvePrimaryRuntime puts the project's newest primary deployment on the
// context, ignoring the request's Origin.
func (h *Handler) resolvePrimaryRuntime(ctx context.Context, projectID string) (context.Context, error) {
	if h.runtime == nil {
		return ctx, nil
	}
	resolution, err := h.runtime.ResolvePrimary(ctx, projectID)
	if err != nil {
		return ctx, err
	}
	return service.WithRuntimeResolution(bindRuntime(ctx, resolution), resolution), nil
}

// withSealedRuntime puts the sealed release back on the context and refuses
// when it was revoked since create. No-op when nothing was sealed. origin is
// the request's Origin the gate admitted, "" when it checked none.
func (h *Handler) withSealedRuntime(ctx context.Context, projectID, deploymentID, releaseID, origin string) (context.Context, error) {
	if releaseID == "" || h.releaseService == nil {
		return ctx, nil
	}
	release, err := h.releaseService.Get(ctx, projectID, releaseID)
	if err != nil {
		return ctx, err
	}
	if release.Revoked() {
		return ctx, domain.ErrReleaseRevoked()
	}
	resolution := &service.RuntimeResolution{Release: release, Origin: origin}
	if deploymentID != "" && h.pool != nil {
		dep, err := h.pool.Statements().GetDeploymentByID(ctx, projectID, deploymentID)
		if err != nil {
			return ctx, err
		}
		resolution.Deployment = dep
	}
	ctx = audit.BindRuntime(ctx, audit.Runtime{DeploymentID: deploymentID, ReleaseID: releaseID, Target: origin})
	return service.WithRuntimeResolution(ctx, resolution), nil
}
