package api

import (
	"context"
	"encoding/json"

	"github.com/zitadel/nextgen/internal/domain"
	"github.com/zitadel/nextgen/internal/service"
)

// ssoProviderPresentation is the part of a connection document a button needs.
// Read here rather than through the identity layer's own parser, which is
// private to it and answers a different question (which fields are immutable).
type ssoProviderPresentation struct {
	DisplayName string  `json:"display_name"`
	Template    *string `json:"template"`
}

// resolveSSOProviders fills in the display name and brand template for the
// connection slugs a rendered step carries.
//
// The engine emits slugs alone: it has no view of the identity layer, and the
// name and template belong to the connection, which the project can revise
// without republishing its flow. Resolving here keeps the flow definition
// naming connections rather than copying their presentation.
//
// A slug with no connection is dropped rather than shown. The flow definition
// and the connections are edited separately -- `zitadel sso enable` writes the
// slug into the flow, and a connection can be removed afterwards -- so a step
// outliving its connection is ordinary, and a button that cannot start a
// sign-in is worse than no button.
//
// A lookup failure drops every provider rather than failing the step: the rest
// of the step is still a usable sign-in, and taking the whole page down over
// the buttons would turn a degraded provider list into an outage.
func (h *Handler) resolveSSOProviders(ctx context.Context, projectID string, step *domain.FlowStep) {
	if step == nil || len(step.SSOProviders) == 0 {
		return
	}
	if h.idpConnectionService == nil {
		step.SSOProviders = nil
		return
	}
	// Unrestricted, as the flow's own definition lookup is: `/flow` is the
	// unauthenticated sign-in endpoint, so there is no caller whose project
	// role could authorise the read. What it returns is not privileged either
	// -- a provider button is shown to anyone who opens the login page.
	listCtx := service.WithAuthzListUnrestricted(ctx)
	result, err := h.idpConnectionService.List(listCtx, service.ListIDPConnectionsInput{ProjectID: projectID})
	if err != nil || result == nil {
		step.SSOProviders = nil
		return
	}
	bySlug := make(map[string]*domain.IDPConnection, len(result.Items))
	for _, item := range result.Items {
		if item != nil {
			bySlug[item.Slug] = item
		}
	}
	resolved := make([]domain.FlowSSOProvider, 0, len(step.SSOProviders))
	for _, provider := range step.SSOProviders {
		connection, ok := bySlug[provider.ID]
		if !ok {
			continue
		}
		var presentation ssoProviderPresentation
		if err := json.Unmarshal(connection.Document, &presentation); err != nil {
			continue
		}
		name := presentation.DisplayName
		if name == "" {
			// Never blank: a button with no label is unusable, and the slug is
			// what the project called the connection.
			name = connection.Slug
		}
		template := ""
		if presentation.Template != nil {
			template = *presentation.Template
		}
		// The slug, not the connection id: it is what the client sends back as
		// `sso_provider_id`, and what the flow definition names.
		resolved = append(resolved, domain.FlowSSOProvider{
			ID:       connection.Slug,
			Name:     name,
			Template: template,
		})
	}
	if len(resolved) == 0 {
		step.SSOProviders = nil
		return
	}
	step.SSOProviders = resolved
}
