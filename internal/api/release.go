package api

import (
	"context"
	"net/http"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Handler) CreateRelease(ctx context.Context, req *api.CreateReleaseRequest, params api.CreateReleaseParams) (api.CreateReleaseRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), releaseAccess, opWrite); err != nil {
		return nil, err
	}

	pointers := make([]service.CreateReleasePointer, 0, len(req.Pointers))
	for _, pointer := range req.Pointers {
		kind, err := domain.ReleasePointerKindString(string(pointer.Kind))
		if err != nil {
			// Unreachable over HTTP — the wire enum is closed and the decoder
			// rejects anything else with req.invalid first.
			return nil, domain.ErrReleaseInvalid("unknown pointer kind", err)
		}
		pointers = append(pointers, service.CreateReleasePointer{
			Kind:       kind,
			RevisionID: pointer.RevisionID,
		})
	}

	result, err := h.releaseService.Create(ctx, service.CreateReleaseInput{
		ProjectID: string(params.ProjectID),
		Pointers:  pointers,
		Message:   optStringPtr(req.Message),
		GitSHA:    optStringPtr(req.GitSha),
		GitDirty:  req.GitDirty.Or(false),
	})
	if err != nil {
		return nil, err
	}

	// 201 only when this call assembled the release. A re-submitted set
	// answers 200 with the release that already pins it, so a re-deploy of
	// unchanged content is a no-op rather than an error the caller has to
	// special-case.
	release := toAPIRelease(result.Release)
	if result.Created {
		created := api.CreateReleaseCreated(release)
		return &created, nil
	}
	reused := api.CreateReleaseOK(release)
	return &reused, nil
}

/* ---------------- CONVERTERS ---------------- */

func toAPIRelease(entity *domain.Release) api.Release {
	pointers := make([]api.ReleasePointer, len(entity.Pointers))
	for i, pointer := range entity.Pointers {
		pointers[i] = api.ReleasePointer{
			Kind:       api.ReleasePointerKind(pointer.Kind.String()),
			Handle:     pointer.Handle,
			RevisionID: pointer.RevisionID,
		}
	}
	return api.Release{
		ID:        api.ReleaseID(entity.ID),
		ProjectID: api.ProjectID(entity.ProjectID),
		Metadata:  toAPIReleaseMetadata(entity),
		Pointers:  pointers,
	}
}

// toAPIReleaseMetadata writes absent fields as explicit nulls rather than
// omitting them, so a client reading `created_by` finds the same shape whether
// the release was assembled by a person or by a pipeline.
func toAPIReleaseMetadata(entity *domain.Release) api.ReleaseMetadata {
	metadata := api.ReleaseMetadata{
		GitDirty:  entity.Metadata.GitDirty,
		CreatedAt: entity.CreatedAt,
	}
	metadata.Message = nilableString(entity.Metadata.Message)
	metadata.GitSha = nilableString(entity.Metadata.GitSHA)
	metadata.CreatedBy = nilableString(entity.Metadata.CreatedBy)
	if entity.Metadata.CreatedByType != nil {
		metadata.CreatedByType = api.NewOptNilReleaseMetadataCreatedByType(
			api.ReleaseMetadataCreatedByType(*entity.Metadata.CreatedByType))
	} else {
		metadata.CreatedByType.SetToNull()
	}
	return metadata
}

func nilableString(value *string) api.OptNilString {
	if value == nil {
		var out api.OptNilString
		out.SetToNull()
		return out
	}
	return api.NewOptNilString(*value)
}

func optStringPtr(value api.OptString) *string {
	if !value.Set {
		return nil
	}
	return &value.Value
}

// releaseErrorResponse maps the release error codes onto statuses. A pinned
// revision that does not exist is the caller's mistake about their own
// project, so it is a 400 naming the pointer rather than a 404 about the
// release, which does not exist yet either way.
func releaseErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrReleaseNotFound().Code, domain.ErrReleaseProjectNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case domain.ErrReleaseInvalid(nil, nil).Code,
		domain.ErrReleaseRevisionNotFound(nil).Code,
		domain.ErrReleaseRevisionUnpinnable(nil).Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	case domain.ErrReleasePermissionDenied().Code:
		return errorResponseWithStatusCode(http.StatusForbidden, err)
	default:
		return internalErrorResponse(err)
	}
}
