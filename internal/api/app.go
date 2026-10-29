package api

import (
	"context"
	"net/http"
	"slices"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// CreateApp writes a registered app. The document is the request body as
// sent, not the decoded body written back out: the decoder would fill in
// nothing here, and storing what was sent keeps a release's file and an API
// write byte-comparable.
func (h *Handler) CreateApp(ctx context.Context, req *api.CreateAppRequest, params api.CreateAppParams) (api.CreateAppRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), appAccess, opWrite); err != nil {
		return nil, err
	}
	document, err := req.App.MarshalJSON()
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to encode app")
	}
	result, err := h.appService.CreateOrRevise(ctx, string(params.ProjectID), document)
	if err != nil {
		return nil, err
	}
	resp, err := toAPIAppResponse(&result.AppView)
	if err != nil {
		return nil, err
	}
	for _, client := range result.Clients {
		if secret, ok := result.Secrets[client.Slug]; ok {
			resp.ClientSecrets = append(resp.ClientSecrets, api.AppClientSecret{Client: client.Slug, Secret: secret})
		}
	}
	if result.Created {
		created := api.CreateAppCreated(resp)
		return &created, nil
	}
	revised := api.CreateAppOK(resp)
	return &revised, nil
}

// App reads resolve the path id through the resource scope index in the
// named project, so a grant scoped to one app reaches that app, its revision
// list and each of its revisions, as for connections.

func (h *Handler) GetAppById(ctx context.Context, params api.GetAppByIdParams) (api.GetAppByIdRes, error) {
	projectID, err := h.requireResourceAccessInProject(ctx, string(params.ProjectID), params.ID, appAccess, opRead)
	if err != nil {
		return nil, err
	}
	view, err := h.appService.Get(ctx, projectID, params.ID)
	if err != nil {
		return nil, err
	}
	resp, err := toAPIAppResponse(view)
	if err != nil {
		return nil, err
	}
	return &resp, nil
}

func (h *Handler) GetAppRevisionById(ctx context.Context, params api.GetAppRevisionByIdParams) (api.GetAppRevisionByIdRes, error) {
	projectID := string(params.ProjectID)
	view, err := h.appService.GetRevision(ctx, projectID, params.RevisionID)
	if err != nil {
		// A miss answers as a revision of an app outside the caller's scope
		// does, so an unknown id cannot be told from a hidden one.
		if accessErr := h.requireTargetAccess(ctx, projectID, params.RevisionID, appAccess, opRead); accessErr != nil {
			return nil, accessErr
		}
		return nil, err
	}
	if _, err := h.requireResourceAccessInProject(ctx, projectID, view.App.ID, appAccess, opRead); err != nil {
		return nil, err
	}
	resp, err := toAPIAppResponse(view)
	if err != nil {
		return nil, err
	}
	return &resp, nil
}

func (h *Handler) ListAppRevisions(ctx context.Context, params api.ListAppRevisionsParams) (api.ListAppRevisionsRes, error) {
	projectID, err := h.requireResourceAccessInProject(ctx, string(params.ProjectID), params.ID, appAccess, opRead)
	if err != nil {
		return nil, err
	}
	// The check above allowed the caller on this app, and every row of the
	// list is one of its revisions.
	ctx = service.WithAuthzListSkipOnce(ctx)
	result, err := h.appService.ListRevisions(ctx, service.ListAppRevisionsInput{
		ProjectID: projectID,
		ID:        params.ID,
		Limit:     int(params.Limit.Or(0)),
		PageToken: string(params.PageToken.Or("")),
	})
	if err != nil {
		return nil, err
	}
	revisions, err := toAPIAppResponses(result.Items)
	if err != nil {
		return nil, err
	}
	resp := &api.ListAppRevisionsResponse{Revisions: revisions}
	if result.NextPageToken != "" {
		resp.NextPageToken = api.NewOptNilPageToken(api.PageToken(result.NextPageToken))
	}
	return resp, nil
}

func (h *Handler) QueryApps(ctx context.Context, req *api.QueryAppsRequest, params api.QueryAppsParams) (api.QueryAppsRes, error) {
	ctx, _, err := h.requireProjectListAccess(ctx, string(params.ProjectID), appAccess, domain.ResourceKindApp)
	if err != nil {
		return nil, err
	}
	input := service.ListAppsInput{
		ProjectID: string(params.ProjectID),
		Limit:     int(req.Limit.Or(0)),
		PageToken: string(req.PageToken.Or("")),
	}
	if sorting, ok := req.Sorting.Get(); ok {
		input.Sorting = sortingToService(sorting.Field, sorting.Direction)
	}
	for _, filter := range req.Filter {
		input.Filters = append(input.Filters, filterToService(filter.Field, filter.Operation, filter.Value))
	}
	result, err := h.appService.List(ctx, input)
	if err != nil {
		return nil, err
	}
	apps, err := toAPIAppResponses(result.Items)
	if err != nil {
		return nil, err
	}
	resp := &api.QueryAppsResponse{Apps: apps}
	if result.NextPageToken != "" {
		resp.NextPageToken = api.NewOptNilPageToken(api.PageToken(result.NextPageToken))
	}
	return resp, nil
}

func (h *Handler) AddAppClientSecret(ctx context.Context, req *api.AddAppClientSecretRequest, params api.AddAppClientSecretParams) (api.AddAppClientSecretRes, error) {
	projectID, err := h.requireResourceAccessInProject(ctx, string(params.ProjectID), params.ID, appAccess, opWrite)
	if err != nil {
		return nil, err
	}
	result, err := h.appService.AddClientSecret(ctx, service.AddAppClientSecretInput{
		ProjectID:  projectID,
		AppID:      params.ID,
		ClientSlug: params.Client,
		Secret:     req.Secret.Or(""),
		Hash:       req.Hash.Or(""),
	})
	if err != nil {
		return nil, err
	}
	resp := &api.AddAppClientSecretResponse{ID: result.SecretID, ClientID: result.ClientID}
	if result.Secret != "" {
		resp.Secret = api.NewOptString(result.Secret)
	}
	return resp, nil
}

/* ---------------- CONVERTERS ---------------- */

func toAPIAppResponse(view *service.AppView) (api.AppResponse, error) {
	entity := view.App
	resp := api.AppResponse{
		ID:         entity.ID,
		RevisionID: entity.RevisionID,
		Slug:       entity.Slug,
		Source:     api.AppResponseSource(entity.Source),
		Clients:    make([]api.AppClientID, 0, len(view.Clients)),
		CreatedAt:  entity.CreatedAt,
		UpdatedAt:  entity.UpdatedAt,
	}
	if err := resp.Definition.UnmarshalJSON(entity.Document); err != nil {
		return api.AppResponse{}, domain.ErrInternal(err).WithMessage("failed to decode stored app")
	}
	for _, client := range view.Clients {
		resp.Clients = append(resp.Clients, api.AppClientID{Slug: client.Slug, ClientID: client.ClientID})
	}
	return resp, nil
}

func toAPIAppResponses(views []*service.AppView) ([]api.AppResponse, error) {
	out := make([]api.AppResponse, 0, len(views))
	for _, view := range views {
		resp, err := toAPIAppResponse(view)
		if err != nil {
			return nil, err
		}
		out = append(out, resp)
	}
	return out, nil
}

// appErrorResponse maps the app error codes onto statuses.
func appErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch {
	case slices.Contains([]string{
		domain.ErrAppNotFound().Code,
		domain.ErrAppClientNotFound().Code,
		domain.ErrAppAPINotFound().Code,
	}, err.Code):
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case slices.Contains([]string{
		domain.ErrAppInvalid(nil).Code,
		domain.ErrAppFieldImmutable(nil).Code,
		domain.ErrInvalidScope(nil).Code,
	}, err.Code):
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	case err.Code == domain.ErrAppClientSecretInvalid().Code:
		// The authorization server answers invalid_client itself; an API path
		// that ever surfaced this would be refusing a credential.
		return errorResponseWithStatusCode(http.StatusUnauthorized, err)
	case err.Code == domain.ErrClientRegistrationNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case err.Code == domain.ErrClientRegistrationInvalid(nil).Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	case err.Code == domain.ErrAppPermissionDenied().Code:
		return errorResponseWithStatusCode(http.StatusForbidden, err)
	case slices.Contains([]string{
		domain.ErrAppDeclared().Code,
		domain.ErrAppClientIDTaken(nil).Code,
		domain.ErrAppIdentifierTaken(nil).Code,
		domain.ErrAppRevisionConflict().Code,
	}, err.Code):
		return errorResponseWithStatusCode(http.StatusConflict, err)
	default:
		return internalErrorResponse(err)
	}
}
