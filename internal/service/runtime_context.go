package service

import (
	"context"

	"github.com/zitadel/nextgen/internal/domain"
)

type runtimeResolutionKey struct{}

// WithRuntimeResolution attaches the environment and release that serve the
// request, so services down the call chain (flow resolution, branding) read
// configuration from the release the request resolved to instead of the
// newest revision. Set by the API edge once the project is known.
func WithRuntimeResolution(ctx context.Context, resolution *RuntimeResolution) context.Context {
	if resolution == nil {
		return ctx
	}
	return context.WithValue(ctx, runtimeResolutionKey{}, resolution)
}

// RuntimeResolutionFromContext returns the request's resolution, or nil when
// the request was not resolved (in-process callers, tests, the resolver not
// wired).
func RuntimeResolutionFromContext(ctx context.Context) *RuntimeResolution {
	resolution, _ := ctx.Value(runtimeResolutionKey{}).(*RuntimeResolution)
	return resolution
}

// ReleaseFromContext is the release the request resolved to, nil when there
// is none (no resolution, or the environment has nothing deployed yet).
func ReleaseFromContext(ctx context.Context) *domain.Release {
	resolution := RuntimeResolutionFromContext(ctx)
	if resolution == nil {
		return nil
	}
	return resolution.Release
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
