package api

import (
	"context"
	"net/http"
	"slices"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Handler) CreateGrant(ctx context.Context, req *api.CreateGrantRequest, params api.CreateGrantParams) (api.CreateGrantRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), grantAccess, opWrite); err != nil {
		return nil, err
	}
	principalType, err := grantPrincipalType(req.PrincipalType)
	if err != nil {
		return nil, err
	}
	input := service.CreateGrantInput{
		ProjectID:     string(params.ProjectID),
		PrincipalType: principalType,
		PrincipalID:   req.PrincipalID,
		Relation:      string(req.Relation),
	}
	if v, ok := req.ExpiresAt.Get(); ok {
		input.ExpiresAt = &v
	}
	grant, err := h.grantService.Create(ctx, input)
	if err != nil {
		return nil, err
	}
	return grantResponse(grant)
}

func (h *Handler) GetGrant(ctx context.Context, params api.GetGrantParams) (api.GetGrantRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), grantAccess, opRead); err != nil {
		return nil, err
	}
	grant, err := h.grantService.Get(ctx, string(params.ProjectID), params.ID)
	if err != nil {
		return nil, err
	}
	return grantResponse(grant)
}

func (h *Handler) QueryGrants(ctx context.Context, req *api.QueryGrantsRequest, params api.QueryGrantsParams) (api.QueryGrantsRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), grantAccess, opRead); err != nil {
		return nil, err
	}
	svcReq := mapQueryGrantsToService(string(params.ProjectID), req)
	if svcReq.IncludePrincipal {
		// Constructors stay in this function so gen_openapi_errors can see
		// user.permission_denied / team.permission_denied on the operation.
		if !hasGranularOrOperator(ctx, "user.read") {
			return nil, domain.ErrUserPermissionDenied().
				WithMessage("expanding a grant principal requires user.read")
		}
		if !hasGranularOrOperator(ctx, "team.read") {
			return nil, domain.ErrTeamPermissionDenied().
				WithMessage("expanding a grant principal requires team.read")
		}
	}
	listed, err := h.grantService.List(ctx, svcReq)
	if err != nil {
		return nil, err
	}
	grants := make([]api.Grant, 0, len(listed.Grants))
	for _, g := range listed.Grants {
		mapped, err := grantResponse(g)
		if err != nil {
			return nil, err
		}
		grants = append(grants, *mapped)
	}
	resp := &api.QueryGrantsResponse{Grants: grants}
	if listed.NextPageToken != "" {
		resp.NextPageToken = api.NewOptNilPageToken(api.PageToken(listed.NextPageToken))
	}
	return resp, nil
}

func mapQueryGrantsToService(projectID string, req *api.QueryGrantsRequest) service.ListGrantsRequest {
	svcReq := service.ListGrantsRequest{
		ProjectID: projectID,
		Limit:     int(req.Limit.Or(0)),
		PageToken: string(req.PageToken.Or("")),
	}
	if sorting, ok := req.Sorting.Get(); ok {
		svcReq.Sorting = sortingToService(sorting.Field, sorting.Direction)
	}
	for _, filter := range req.Filter {
		svcReq.Filters = append(svcReq.Filters, filterToService(filter.Field, filter.Operation, filter.Value))
	}
	svcReq.IncludePrincipal = slices.Contains(req.Expand, api.GrantExpandPrincipal)
	return svcReq
}

func (h *Handler) DeleteGrant(ctx context.Context, params api.DeleteGrantParams) (api.DeleteGrantRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), grantAccess, opDelete); err != nil {
		return nil, err
	}
	if err := h.grantService.Revoke(ctx, string(params.ProjectID), params.ID); err != nil {
		return nil, err
	}
	return &api.DeleteGrantNoContent{}, nil
}

func grantResponse(g *service.Grant) (*api.Grant, error) {
	if g == nil || g.Assignment == nil {
		return nil, domain.ErrGrantNotFound()
	}
	asgn := g.Assignment
	resp := &api.Grant{
		ID:            asgn.ID,
		ProjectID:     asgn.ProjectID,
		PrincipalType: api.GrantPrincipalType(asgn.PrincipalType.String()),
		PrincipalID:   asgn.PrincipalID,
		ObjectType:    api.GrantObjectTypeProject,
		Relation:      api.GrantRelation(asgn.Relation),
		CreatedAt:     asgn.CreatedAt,
	}
	if asgn.ExpiresAt != nil {
		resp.ExpiresAt = api.NewOptNilDateTime(*asgn.ExpiresAt)
	}
	if g.User != nil {
		resp.User = api.NewOptUserRef(userRefToAPI(*g.User))
	}
	if g.Team != nil {
		ref := api.TeamRef{TeamID: g.Team.TeamID}
		if g.Team.Name != "" {
			ref.Name = api.NewOptString(g.Team.Name)
		}
		resp.Team = api.NewOptTeamRef(ref)
	}
	if g.Principal != nil {
		if err := setGrantPrincipal(resp, g.Principal); err != nil {
			return nil, err
		}
	}
	return resp, nil
}

func setGrantPrincipal(resp *api.Grant, principal *service.GrantPrincipal) error {
	switch {
	case principal.User != nil:
		u, err := domainUserToApiUser(principal.User)
		if err != nil {
			return err
		}
		resp.Principal.SetTo(api.NewUserGrantExpandedPrincipal(*u))
	case principal.Team != nil:
		resp.Principal.SetTo(api.NewTeamResponseGrantExpandedPrincipal(*teamResponse(principal.Team)))
	default:
		resp.Principal.SetToNull()
	}
	return nil
}

func grantPrincipalType(t api.CreateGrantRequestPrincipalType) (domain.AuthzPrincipalType, error) {
	switch t {
	case api.CreateGrantRequestPrincipalTypeUser:
		return domain.AuthzPrincipalTypeUser, nil
	case api.CreateGrantRequestPrincipalTypeTeam:
		return domain.AuthzPrincipalTypeTeam, nil
	default:
		return "", domain.ErrGrantInvalid().WithDetails("principal_type must be user or team")
	}
}

func grantErrorResponse(err domain.Error) *api.ErrorDetailsStatusCode {
	switch err.Code {
	case domain.ErrGrantInvalid().Code:
		return errorResponseWithStatusCode(http.StatusBadRequest, err)
	case domain.ErrGrantNotFound().Code, domain.ErrGrantPrincipalNotFound().Code:
		return errorResponseWithStatusCode(http.StatusNotFound, err)
	case domain.ErrGrantAlreadyExists().Code:
		return errorResponseWithStatusCode(http.StatusConflict, err)
	case domain.ErrGrantPermissionDenied().Code:
		return errorResponseWithStatusCode(http.StatusForbidden, err)
	default:
		return internalErrorResponse(err)
	}
}
