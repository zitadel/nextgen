package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Handler) RevokeRelease(ctx context.Context, params api.RevokeReleaseParams) (api.RevokeReleaseRes, error) {
	// Scoped to the project like the read, so a release of another project
	// answers not found rather than confirming it exists.
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), releaseAccess, opWrite); err != nil {
		return nil, err
	}

	entity, err := h.releaseService.Revoke(ctx, string(params.ProjectID), string(params.ReleaseID))
	if conflict, ok := releaseInUseConflict(err); ok {
		return conflict, nil
	}
	if err != nil {
		return nil, err
	}
	release := toAPIRelease(entity)
	return &release, nil
}

// releaseInUseConflict answers rel.in_use with the typed 409, whose
// details.origins names each origin still serving the release. Through
// NewError the details would nest under details.details.
func releaseInUseConflict(err error) (*api.RevokeReleaseConflict, bool) {
	de, ok := errors.AsType[domain.Error](err)
	if !ok || de.Code != domain.ErrReleaseInUse(domain.ReleaseInUseDetails{}).Code {
		return nil, false
	}
	details, _ := de.Details.(domain.ReleaseInUseDetails)
	resp := api.RevokeReleaseConflict{Code: api.ErrorCode(de.Code), Message: de.Message}
	resp.Details.Origins = make([]api.RevokeReleaseConflictDetailsOriginsItem, len(details.Origins))
	for i, origin := range details.Origins {
		resp.Details.Origins[i] = api.RevokeReleaseConflictDetailsOriginsItem{
			Origin:       api.Origin(origin.Origin),
			DeploymentID: api.DeploymentID(origin.DeploymentID),
		}
	}
	return &resp, true
}

func (h *Handler) BuildRelease(ctx context.Context, req *api.BuildReleaseRequest, params api.BuildReleaseParams) (api.BuildReleaseRes, error) {
	projectID := string(params.ProjectID)
	if err := h.requireProjectAccess(ctx, projectID, releaseAccess, opWrite); err != nil {
		return nil, err
	}
	if err := requireBuildKindScopes(ctx, req.Bundle); err != nil {
		return nil, err
	}

	input, err := mapBuildReleaseRequest(projectID, req)
	if err != nil {
		return nil, err
	}

	result, err := h.releaseService.Build(ctx, input)
	if err != nil {
		if bundleErr, ok := errors.AsType[*service.BundleValidationError](err); ok {
			return bundleValidationBadRequest(bundleErr), nil
		}
		return nil, err
	}

	// 201 only when this call assembled the release. A re-submitted bundle
	// answers 200 with the release that already pins the same content.
	release := toAPIRelease(result.Release)
	if result.Created {
		created := api.BuildReleaseCreated(release)
		return &created, nil
	}
	reused := api.BuildReleaseOK(release)
	return &reused, nil
}

func requireBuildKindScopes(ctx context.Context, bundle api.ConfigurationBundle) error {
	checks := []struct {
		needed bool
		scope  string
		kind   string
	}{
		{len(bundle.Schemas) > 0, "schema.write", "schemas"},
		{len(bundle.FlowDefinitions) > 0, "flow_definition.write", "flow_definitions"},
		{len(bundle.Idps) > 0, "idp.write", "idps"},
		{bundle.Branding.IsSet(), "branding.write", "branding"},
	}
	for _, check := range checks {
		if !check.needed {
			continue
		}
		if hasGranularOrOperator(ctx, check.scope) {
			continue
		}
		return domain.ErrReleasePermissionDenied().WithMessage(
			fmt.Sprintf("release: building with %s needs %s", check.kind, check.scope))
	}
	return nil
}

func mapBuildReleaseRequest(projectID string, req *api.BuildReleaseRequest) (service.BuildReleaseInput, error) {
	input := service.BuildReleaseInput{
		ProjectID: projectID,
		GitDirty:  req.GitDirty.Or(false),
	}
	if message, ok := req.Message.Get(); ok {
		input.Message = &message
	}
	if gitSHA, ok := req.GitSha.Get(); ok {
		input.GitSHA = &gitSHA
	}

	for i, item := range req.Bundle.Schemas {
		switch item.Type {
		case api.UserSchemaConfigurationBundleSchemasItem:
			doc, err := item.UserSchema.MarshalJSON()
			if err != nil {
				return input, domain.ErrReleaseInvalid("schema is not serialisable", err)
			}
			input.Schemas = append(input.Schemas, service.BuildSchema{Index: i, Document: doc})
		case api.SchemaURLConfigurationBundleSchemasItem:
			input.Schemas = append(input.Schemas, service.BuildSchema{
				Index: i,
				URL:   item.SchemaURL.URL.String(),
			})
		default:
			return input, domain.ErrReleaseInvalid(fmt.Sprintf("unknown schema kind %q", item.Type), nil)
		}
	}

	for i, definition := range req.Bundle.FlowDefinitions {
		svcReq, err := mapCreateRequestToService(&api.CreateFlowDefinitionRequest{
			ProjectID:      api.ProjectID(projectID),
			FlowDefinition: definition,
		})
		if err != nil {
			return input, err
		}
		input.FlowDefinitions = append(input.FlowDefinitions, service.BuildFlowDefinition{
			Index:   i,
			Request: svcReq,
		})
	}

	for i, idp := range req.Bundle.Idps {
		doc, err := idp.MarshalJSON()
		if err != nil {
			return input, domain.ErrReleaseInvalid("idp is not serialisable", err)
		}
		input.IDPs = append(input.IDPs, service.BuildIDP{Index: i, Document: doc})
	}

	if branding, ok := req.Bundle.Branding.Get(); ok {
		input.Branding = &service.CreateBrandingInput{
			ProjectID:      projectID,
			Layout:         string(branding.Layout.Value),
			LiquidTemplate: branding.LiquidTemplate.Value,
			LogoURL:        optURIString(branding.LogoURL),
			HeroURL:        optURIString(branding.HeroURL),
			Theme:          brandingThemeFromAPI(branding.Theme),
			Typography:     brandingTypographyFromAPI(branding.Typography),
			Shape:          brandingShapeFromAPI(branding.Shape),
		}
	}
	return input, nil
}

func bundleValidationBadRequest(err *service.BundleValidationError) *api.BuildReleaseBadRequest {
	resources := make([]api.BundleResourceError, 0, len(err.Resources))
	for _, failure := range err.Resources {
		item := api.BundleResourceError{
			Code:    api.ErrorCode(failure.Err.Code),
			Message: failure.Err.Message,
			Kind:    api.ReleasePointerKind(failure.Kind.String()),
			Index:   failure.Index,
		}
		if failure.Handle != "" {
			item.Handle = api.NewOptString(failure.Handle)
		}
		if raw, ok := marshalErrorDetails(failure.Err.Details); ok {
			item.Details = api.NewOptBundleResourceErrorDetails(api.BundleResourceErrorDetails{
				"details": raw,
			})
		}
		resources = append(resources, item)
	}
	return &api.BuildReleaseBadRequest{
		Code:    api.ErrorCode(domain.ErrReleaseInvalid(nil, nil).Code),
		Message: domain.ErrReleaseInvalid(nil, nil).Message,
		Details: api.NewOptBuildReleaseBadRequestDetails(api.BuildReleaseBadRequestDetails{
			Resources: resources,
		}),
	}
}

func (h *Handler) CreateRelease(ctx context.Context, req *api.CreateReleaseRequest, params api.CreateReleaseParams) (api.CreateReleaseRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), releaseAccess, opWrite); err != nil {
		return nil, err
	}

	pointers := make([]service.CreateReleasePointer, 0, len(req.Pointers))
	for _, pointer := range req.Pointers {
		kind, err := domain.ReleasePointerKindString(string(pointer.Kind))
		if err != nil {
			// The decoder rejects kinds outside the wire enum with req.invalid,
			// so this is reached only by a kind the contract admits before the
			// service resolves it: idp, until the release service learns it.
			return nil, domain.ErrReleaseInvalid("unknown pointer kind", err)
		}
		pointers = append(pointers, service.CreateReleasePointer{
			Kind:       kind,
			RevisionID: pointer.RevisionID,
		})
	}

	input := service.CreateReleaseInput{
		ProjectID: string(params.ProjectID),
		Pointers:  pointers,
		GitDirty:  req.GitDirty.Or(false),
	}
	if message, ok := req.Message.Get(); ok {
		input.Message = &message
	}
	if gitSHA, ok := req.GitSha.Get(); ok {
		input.GitSHA = &gitSHA
	}

	result, err := h.releaseService.Create(ctx, input)
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

func (h *Handler) GetReleaseById(ctx context.Context, params api.GetReleaseByIdParams) (api.GetReleaseByIdRes, error) {
	// Releases are addressed by a path id, but the read is scoped to the
	// project the caller named, so a release of another project reads as an
	// unknown id rather than a forbidden one and is no existence oracle.
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), releaseAccess, opRead); err != nil {
		return nil, err
	}

	entity, err := h.releaseService.Get(ctx, string(params.ProjectID), string(params.ReleaseID))
	if err != nil {
		return nil, err
	}
	release := toAPIRelease(entity)
	return &release, nil
}

func (h *Handler) ListReleases(ctx context.Context, params api.ListReleasesParams) (api.ListReleasesRes, error) {
	ctx, _, err := h.requireProjectListAccess(ctx, string(params.ProjectID), releaseAccess, domain.ResourceKindRelease)
	if err != nil {
		return nil, err
	}

	result, err := h.releaseService.List(ctx, service.ListReleasesInput{
		ProjectID: string(params.ProjectID),
		PageToken: string(params.PageToken.Value),
		Limit:     int(params.Limit.Value),
	})
	if err != nil {
		return nil, err
	}

	resp := api.ListReleasesResponse{Releases: make([]api.ReleaseSummary, len(result.Items))}
	for i, entity := range result.Items {
		resp.Releases[i] = api.ReleaseSummary{
			ID:          api.ReleaseID(entity.ID),
			ProjectID:   api.ProjectID(entity.ProjectID),
			ContentHash: toAPIReleaseContentHash(entity.ContentHash),
			Metadata:    toAPIReleaseMetadata(entity),
			RevokedAt:   toAPIRevokedAt(entity),
		}
	}
	if result.NextPageToken != "" {
		resp.NextPageToken = api.NewOptNilPageToken(api.PageToken(result.NextPageToken))
	}
	return &resp, nil
}

/* ---------------- CONVERTERS ---------------- */

// releaseContentHashWirePrefix names the digest algorithm on the wire. The
// store keeps the bare hex; the prefix is added here and stripped here.
const releaseContentHashWirePrefix = "sha256:"

func toAPIReleaseContentHash(hash string) api.ReleaseContentHash {
	return api.ReleaseContentHash(releaseContentHashWirePrefix + hash)
}

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
		ID:          api.ReleaseID(entity.ID),
		ProjectID:   api.ProjectID(entity.ProjectID),
		ContentHash: toAPIReleaseContentHash(entity.ContentHash),
		Metadata:    toAPIReleaseMetadata(entity),
		RevokedAt:   toAPIRevokedAt(entity),
		Pointers:    pointers,
	}
}

// toAPIRevokedAt writes the revocation time, or an explicit null.
func toAPIRevokedAt(entity *domain.Release) api.NilDateTime {
	if entity.RevokedAt == nil {
		return api.NilDateTime{Null: true}
	}
	return api.NewNilDateTime(*entity.RevokedAt)
}

// toAPIReleaseMetadata writes absent fields as explicit nulls rather than
// omitting them, so a client reading `created_by` finds the same shape whether
// the release was assembled by a person or by a pipeline.
func toAPIReleaseMetadata(entity *domain.Release) api.ReleaseMetadata {
	metadata := api.ReleaseMetadata{
		GitDirty:  entity.Metadata.GitDirty,
		CreatedAt: entity.CreatedAt,
	}
	if message := entity.Metadata.Message; message != nil {
		metadata.Message.SetTo(*message)
	} else {
		metadata.Message.SetToNull()
	}
	if gitSHA := entity.Metadata.GitSHA; gitSHA != nil {
		metadata.GitSha.SetTo(*gitSHA)
	} else {
		metadata.GitSha.SetToNull()
	}
	if createdBy := entity.Metadata.CreatedBy; createdBy != nil {
		metadata.CreatedBy.SetTo(*createdBy)
	} else {
		metadata.CreatedBy.SetToNull()
	}
	if createdByType := entity.Metadata.CreatedByType; createdByType != nil {
		metadata.CreatedByType.SetTo(api.ReleaseMetadataCreatedByType(*createdByType))
	} else {
		metadata.CreatedByType.SetToNull()
	}
	return metadata
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
		domain.ErrReleaseRevisionUnpinnable(nil).Code,
		domain.ErrReleaseUnresolvedReference().Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	case domain.ErrReleasePermissionDenied().Code:
		return errorResponseWithStatusCode(http.StatusForbidden, err)
	case domain.ErrReleaseRevoked().Code, domain.ErrReleaseNotDeployed(nil).Code, domain.ErrReleaseInUse(domain.ReleaseInUseDetails{}).Code:
		return errorResponseWithStatusCode(http.StatusConflict, err)
	default:
		return internalErrorResponse(err)
	}
}
