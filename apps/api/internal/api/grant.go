package api

import (
	"context"
	"net/http"
	"slices"

	api "github.com/zitadel/nextgen/internal/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

func (h *Handler) CreateGrant(ctx context.Context, req *api.CreateGrantRequest, params api.CreateGrantParams) (api.CreateGrantRes, error) {
	// opDelete, for its project.admin check: a grant can carry any role up to
	// admin, so an editor minting one could escalate itself (e.g. admin to a
	// team it is a member of). The op's miss shape does not matter here —
	// grantAccess answers a no-foothold miss with grant.not_found either way.
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), grantAccess, opDelete); err != nil {
		return nil, err
	}
	input, err := createGrantInput(string(params.ProjectID), req)
	if err != nil {
		return nil, err
	}
	input.CallerUserID = grantCallerUserID(ctx)
	grant, err := h.grantService.Create(ctx, input)
	if err != nil {
		return nil, err
	}
	if input.Identifier != "" {
		// Hit, duplicate, miss and ambiguity all land here: an empty 202
		// leaves nothing to compare and no id to replay through user_id.
		return &api.CreateGrantAccepted{}, nil
	}
	return grantResponse(grant)
}

func grantCallerUserID(ctx context.Context) string {
	scope, ok := GetScopeContext(ctx)
	if !ok || scope.PrincipalType != domain.AuthzPrincipalTypeUser {
		return ""
	}
	return scope.PrincipalID
}

func (h *Handler) GetGrant(ctx context.Context, params api.GetGrantParams) (api.GetGrantRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), grantAccess, opRead); err != nil {
		return nil, err
	}
	includePrincipal := slices.Contains(params.Expand, api.GrantExpandPrincipal)
	// A literal, not the method value: gen_openapi_errors follows a func
	// literal argument, so the operation lists user.permission_denied.
	grant, err := h.grantService.Get(ctx, string(params.ProjectID), params.GrantID, includePrincipal, func(ctx context.Context, home string) error {
		return h.requirePrincipalRead(ctx, home)
	})
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
	listed, err := h.grantService.List(ctx, svcReq, func(ctx context.Context, home string) error {
		return h.requirePrincipalRead(ctx, home)
	})
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

// requirePrincipalRead allows expand=principal only to a caller who may read
// the users of the principal's home project: the same resolver Check, one per
// home. User read and team read both resolve to the project's viewer
// relation, so it covers team principals too. project.write on the protected
// project does not satisfy it, and a session is not exempt (ADR 059).
func (h *Handler) requirePrincipalRead(ctx context.Context, homeProjectID string) error {
	err := h.requireProjectAccess(ctx, homeProjectID, userAccess, opRead)
	if err == nil {
		return nil
	}
	if domain.IsServerFault(err) {
		return err
	}
	return domain.ErrUserPermissionDenied().WithParent(err).
		WithMessage("expanding a grant principal requires read access to its home project")
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
	if err := h.grantService.Revoke(ctx, string(params.ProjectID), params.GrantID); err != nil {
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
	attributes, err := convertUsingJson[api.UserAttributes](userData)
	if err != nil {
		return out, err
	}
	out.Attributes.SetTo(*attributes)
	out.Metadata.SetTo(userMetadataToAPI(u))
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
	case domain.ErrGrantPermissionDenied().Code, domain.ErrGrantProjectUnclaimed().Code:
		return errorResponseWithStatusCode(http.StatusForbidden, err)
	default:
		return internalErrorResponse(err)
	}
}
