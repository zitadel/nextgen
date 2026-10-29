package api

import (
	"context"

	api "github.com/zitadel/nextgen/api/generated"
	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// Clients register themselves at the authorization server's registration
// endpoint; this API only lists, reads and deletes what they registered.

func (h *Handler) QueryClientRegistrations(ctx context.Context, req *api.QueryClientRegistrationsRequest, params api.QueryClientRegistrationsParams) (api.QueryClientRegistrationsRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), clientRegistrationAccess, opRead); err != nil {
		return nil, err
	}
	input := service.ListClientRegistrationsInput{
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
	result, err := h.clientRegistrations.List(ctx, input)
	if err != nil {
		return nil, err
	}
	resp := &api.QueryClientRegistrationsResponse{ClientRegistrations: make([]api.ClientRegistrationResponse, 0, len(result.Items))}
	for _, item := range result.Items {
		resp.ClientRegistrations = append(resp.ClientRegistrations, toAPIClientRegistration(item))
	}
	if result.NextPageToken != "" {
		resp.NextPageToken = api.NewOptNilPageToken(api.PageToken(result.NextPageToken))
	}
	return resp, nil
}

func (h *Handler) GetClientRegistrationById(ctx context.Context, params api.GetClientRegistrationByIdParams) (api.GetClientRegistrationByIdRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), clientRegistrationAccess, opRead); err != nil {
		return nil, err
	}
	registration, err := h.clientRegistrations.Get(ctx, string(params.ProjectID), params.ID)
	if err != nil {
		return nil, err
	}
	resp := toAPIClientRegistration(registration)
	return &resp, nil
}

func (h *Handler) DeleteClientRegistration(ctx context.Context, params api.DeleteClientRegistrationParams) (api.DeleteClientRegistrationRes, error) {
	if err := h.requireProjectAccess(ctx, string(params.ProjectID), clientRegistrationAccess, opWrite); err != nil {
		return nil, err
	}
	if err := h.clientRegistrations.Delete(ctx, string(params.ProjectID), params.ID); err != nil {
		return nil, err
	}
	return &api.DeleteClientRegistrationNoContent{}, nil
}

func toAPIClientRegistration(registration *domain.ClientRegistration) api.ClientRegistrationResponse {
	m := registration.Metadata
	resp := api.ClientRegistrationResponse{
		ID:                      registration.ID,
		ClientName:              optAPIString(m.ClientName),
		ClientURI:               optAPIString(m.ClientURI),
		LogoURI:                 optAPIString(m.LogoURI),
		PolicyURI:               optAPIString(m.PolicyURI),
		TosURI:                  optAPIString(m.TOSURI),
		SoftwareID:              optAPIString(m.SoftwareID),
		SoftwareVersion:         optAPIString(m.SoftwareVersion),
		RedirectUris:            m.RedirectURIs,
		GrantTypes:              make([]api.ClientRegistrationResponseGrantTypesItem, 0, len(m.GrantTypes)),
		TokenEndpointAuthMethod: api.ClientRegistrationResponseTokenEndpointAuthMethod(m.AuthMethod),
		CreatedAt:               registration.CreatedAt,
		ExpiresAt:               registration.ExpiresAt,
	}
	for _, grant := range m.GrantTypes {
		resp.GrantTypes = append(resp.GrantTypes, api.ClientRegistrationResponseGrantTypesItem(grant))
	}
	return resp
}
