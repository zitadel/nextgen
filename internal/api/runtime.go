package api

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// resolveRuntime decides which release serves a request from Origin and puts
// the answer on the context.
//
// TODO(#1616): a missing Origin keeps the pre-resolution path. Answer
// rel.not_deployed once the project default target exists. An open admission
// with nothing deployed takes the same path inside RuntimeResolver.Resolve.
func (h *Handler) resolveRuntime(ctx context.Context, projectID, origin string) (context.Context, error) {
	if h.runtime == nil || origin == "" {
		return ctx, nil
	}
	resolution, err := h.runtime.Resolve(ctx, projectID, origin)
	if err != nil {
		return ctx, err
	}
	if resolution == nil {
		return ctx, nil
	}
	return service.WithRuntimeResolution(ctx, resolution), nil
}

// withSealedRuntime puts the sealed release back on the context and refuses
// when it was revoked since create. No-op when nothing was sealed.
func (h *Handler) withSealedRuntime(ctx context.Context, projectID, deploymentID, releaseID string) (context.Context, error) {
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
	resolution := &service.RuntimeResolution{Release: release}
	if deploymentID != "" && h.pool != nil {
		dep, err := h.pool.Statements().GetDeploymentByID(ctx, projectID, deploymentID)
		if err != nil {
			return ctx, err
		}
		resolution.Deployment = dep
	}
	return service.WithRuntimeResolution(ctx, resolution), nil
}
