package api

import (
	"context"
	"net/http"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Handler) CreateIdp(ctx context.Context, req *api.CreateIdpRequest, params api.CreateIdpParams) (api.CreateIdpRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), idpAccess, opWrite); err != nil {
		return nil, err
	}
	// The stored document is the decoded request written back out, so the
	// defaults the decoder filled in are part of the revision.
	document, err := req.Idp.MarshalJSON()
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to encode identity provider connection")
	}
	result, err := h.idpConnectionService.CreateOrRevise(ctx, string(params.ProjectID), document)
	if err != nil {
		return nil, err
	}
	resp, err := toAPIIdpResponse(result.Connection)
	if err != nil {
		return nil, err
	}
	if result.Created {
		created := api.CreateIdpCreated(resp)
		return &created, nil
	}
	revised := api.CreateIdpOK(resp)
	return &revised, nil
}

// Connection reads resolve the path id through the resource scope index in
// the named project, so a grant scoped to one connection reaches that
// connection and its revision list. A single revision is read project-scoped
// because revisions have no index row, so it needs a project-level grant.

func (h *Handler) GetIdpById(ctx context.Context, params api.GetIdpByIdParams) (api.GetIdpByIdRes, error) {
	projectID, err := h.requireResourceAccessInProject(ctx, string(params.ProjectID), params.ID, idpAccess, opRead)
	if err != nil {
		return nil, err
	}
	entity, err := h.idpConnectionService.Get(ctx, projectID, params.ID)
	if err != nil {
		return nil, err
	}
	resp, err := toAPIIdpResponse(entity)
	if err != nil {
		return nil, err
	}
	return &resp, nil
}

func (h *Handler) GetIdpRevisionById(ctx context.Context, params api.GetIdpRevisionByIdParams) (api.GetIdpRevisionByIdRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), idpAccess, opRead); err != nil {
		return nil, err
	}
	entity, err := h.idpConnectionService.GetRevision(ctx, string(params.ProjectID), params.RevisionID)
	if err != nil {
		return nil, err
	}
	resp, err := toAPIIdpResponse(entity)
	if err != nil {
		return nil, err
	}
	return &resp, nil
}

func (h *Handler) ListIdpRevisions(ctx context.Context, params api.ListIdpRevisionsParams) (api.ListIdpRevisionsRes, error) {
	projectID, err := h.requireResourceAccessInProject(ctx, string(params.ProjectID), params.ID, idpAccess, opRead)
	if err != nil {
		return nil, err
	}
	// The revisions are a list statement, which fails closed without list
	// authz on the context. The check above allowed the caller on this very
	// connection, and every row of the list is one of its revisions, so the
	// list needs no filter and takes the one-shot skip.
	ctx = service.WithAuthzListSkipOnce(ctx)
	result, err := h.idpConnectionService.ListRevisions(ctx, service.ListIDPConnectionRevisionsInput{
		ProjectID: projectID,
		ID:        params.ID,
		Limit:     int(params.Limit.Or(0)),
		PageToken: string(params.PageToken.Or("")),
	})
	if err != nil {
		return nil, err
	}
	revisions, err := toAPIIdpResponses(result.Items)
	if err != nil {
		return nil, err
	}
	resp := &api.ListIdpRevisionsResponse{Revisions: revisions}
	if result.NextPageToken != "" {
		resp.NextPageToken = api.NewOptNilPageToken(api.PageToken(result.NextPageToken))
	}
	return resp, nil
}

func (h *Handler) QueryIdps(ctx context.Context, req *api.QueryIdpsRequest, params api.QueryIdpsParams) (api.QueryIdpsRes, error) {
	ctx, err := h.requireProjectListAccess(ctx, string(params.ProjectID), idpAccess, domain.ResourceKindIDPConnection)
	if err != nil {
		return nil, err
	}
	input := service.ListIDPConnectionsInput{
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
	result, err := h.idpConnectionService.List(ctx, input)
	if err != nil {
		return nil, err
	}
	idps, err := toAPIIdpResponses(result.Items)
	if err != nil {
		return nil, err
	}
	resp := &api.QueryIdpsResponse{Idps: idps}
	if result.NextPageToken != "" {
		resp.NextPageToken = api.NewOptNilPageToken(api.PageToken(result.NextPageToken))
	}
	return resp, nil
}

/* ---------------- CONVERTERS ---------------- */

func toAPIIdpResponse(entity *domain.IDPConnection) (api.IdpResponse, error) {
	resp := api.IdpResponse{
		ID:         entity.ID,
		RevisionID: entity.RevisionID,
		Slug:       entity.Slug,
		CreatedAt:  entity.CreatedAt,
		UpdatedAt:  entity.UpdatedAt,
	}
	if err := resp.Definition.UnmarshalJSON(entity.Document); err != nil {
		return api.IdpResponse{}, domain.ErrInternal(err).WithMessage("failed to decode stored identity provider connection")
	}
	return resp, nil
}

func toAPIIdpResponses(entities []*domain.IDPConnection) ([]api.IdpResponse, error) {
	out := make([]api.IdpResponse, 0, len(entities))
	for _, entity := range entities {
		resp, err := toAPIIdpResponse(entity)
		if err != nil {
			return nil, err
		}
		out = append(out, resp)
	}
	return out, nil
}

// idpErrorResponse maps the IdP connection error codes onto statuses.
func idpErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrIDPConnectionNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case domain.ErrIDPConnectionFieldImmutable(nil).Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	case domain.ErrIDPConnectionPermissionDenied().Code:
		return errorResponseWithStatusCode(http.StatusForbidden, err)
	case domain.ErrIDPConnectionRevisionConflict().Code:
		return errorResponseWithStatusCode(http.StatusConflict, err)
	default:
		return internalErrorResponse(err)
	}
}
