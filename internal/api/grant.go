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
	input, err := createGrantInput(string(params.ProjectID), req)
	if err != nil {
		return nil, err
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
	includePrincipal := slices.Contains(params.Expand, api.GrantExpandPrincipal)
	if includePrincipal {
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
	grant, err := h.grantService.Get(ctx, string(params.ProjectID), params.ID, includePrincipal)
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

func createGrantInput(projectID string, req *api.CreateGrantRequest) (service.CreateGrantInput, error) {
	input := service.CreateGrantInput{
		ProjectID: projectID,
		Relation:  string(req.Relation),
	}
	if v, ok := req.ExpiresAt.Get(); ok {
		input.ExpiresAt = &v
	}
	user, hasUser := req.User.Get()
	team, hasTeam := req.Team.Get()
	if hasUser == hasTeam {
		return input, domain.ErrGrantInvalid().WithDetails("exactly one of user or team is required")
	}
	if hasUser {
		userID, hasID := user.UserID.Get()
		identifier, hasIdentifier := user.Identifier.Get()
		if hasID == hasIdentifier {
			return input, domain.ErrGrantInvalid().WithDetails("user requires exactly one of user_id or identifier")
		}
		if hasID {
			input.UserID = string(userID)
		} else {
			input.Identifier = identifier
		}
		return input, nil
	}
	teamID, hasID := team.TeamID.Get()
	name, hasName := team.Name.Get()
	if hasID == hasName {
		return input, domain.ErrGrantInvalid().WithDetails("team requires exactly one of team_id or name")
	}
	if hasID {
		input.TeamID = string(teamID)
	} else {
		input.TeamName = name
	}
	return input, nil
}

func grantResponse(g *service.Grant) (*api.Grant, error) {
	if g == nil || g.Assignment == nil {
		return nil, domain.ErrGrantNotFound()
	}
	asgn := g.Assignment
	resp := &api.Grant{
		ID:         asgn.ID,
		ProjectID:  asgn.ProjectID,
		ObjectType: api.GrantObjectTypeProject,
		Relation:   api.GrantRelation(asgn.Relation),
		CreatedAt:  asgn.CreatedAt,
	}
	if asgn.ExpiresAt != nil {
		resp.ExpiresAt = api.NewOptNilDateTime(*asgn.ExpiresAt)
	}
	switch asgn.PrincipalType {
	case domain.AuthzPrincipalTypeUser:
		user, err := grantUserResponse(g)
		if err != nil {
			return nil, err
		}
		resp.User.SetTo(user)
	case domain.AuthzPrincipalTypeTeam:
		resp.Team.SetTo(grantTeamResponse(g))
	}
	return resp, nil
}

func grantUserResponse(g *service.Grant) (api.GrantUser, error) {
	ref := domain.UserRef{UserID: g.Assignment.PrincipalID}
	if g.User != nil {
		ref = *g.User
	}
	out := api.GrantUser{UserID: api.UserID(ref.UserID)}
	if ref.Identifier != "" {
		out.Identifier = api.NewOptString(ref.Identifier)
		out.IdentifierProperty = api.NewOptString(ref.IdentifierProperty)
	}
	if ref.Display != "" {
		out.Display = api.NewOptString(ref.Display)
	}
	if g.Principal == nil || g.Principal.User == nil {
		return out, nil
	}
	u := g.Principal.User
	out.Schema.SetTo(u.SchemaURL)
	userData, err := u.Attributes.ToMap()
	if err != nil {
		return out, domain.ErrInternal(err).WithMessage("failed to parse user attributes")
	}
	attributes, err := convertUsingJson[api.GrantUserAttributes](userData)
	if err != nil {
		return out, err
	}
	out.Attributes.SetTo(*attributes)
	var lifecycleOwnerTeamID api.OptNilString
	if teamID, ok := u.OwningTeamID(); ok {
		lifecycleOwnerTeamID.SetTo(teamID)
	} else {
		lifecycleOwnerTeamID.SetToNull()
	}
	out.Metadata.SetTo(api.UserMetadata{
		CreatedAt:            u.Metadata.CreatedAt,
		UpdatedAt:            u.Metadata.UpdatedAt,
		Status:               api.UserMetadataStatus(u.Metadata.Status),
		LifecycleOwnerTeamID: lifecycleOwnerTeamID,
	})
	return out, nil
}

func grantTeamResponse(g *service.Grant) api.GrantTeam {
	out := api.GrantTeam{TeamID: g.Assignment.PrincipalID}
	if g.Team != nil {
		out.TeamID = g.Team.TeamID
		if g.Team.Name != "" {
			out.Name = api.NewOptString(g.Team.Name)
		}
	}
	if g.Principal != nil && g.Principal.Team != nil {
		t := g.Principal.Team
		out.Status.SetTo(teamStatus(t.Status))
		out.CreatedAt.SetTo(t.CreatedAt)
		out.UpdatedAt.SetTo(t.UpdatedAt)
	}
	return out
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
