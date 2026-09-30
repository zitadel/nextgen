package service

import (
	"context"
	"errors"
	"log/slog"

	"github.com/zitadel/nextgen/internal/domain"
)

// FlowSSOProviderResolver implements [domain.FlowSSOProviderResolver] over
// the connection service. Each slug is read at its newest revision; a slug
// with no connection is dropped and logged with the step it came from.
type FlowSSOProviderResolver struct {
	connections IDPConnectionService
}

func NewFlowSSOProviderResolver(connections IDPConnectionService) *FlowSSOProviderResolver {
	return &FlowSSOProviderResolver{connections: connections}
}

var _ domain.FlowSSOProviderResolver = (*FlowSSOProviderResolver)(nil)

func (r *FlowSSOProviderResolver) Resolve(ctx context.Context, projectID, stepName string, slugs []string) ([]domain.FlowSSOProvider, error) {
	providers := make([]domain.FlowSSOProvider, 0, len(slugs))
	for _, slug := range slugs {
		connection, err := r.connections.GetBySlug(ctx, projectID, slug)
		if errors.Is(err, domain.ErrIDPConnectionNotFound()) {
			getLoggingContext(ctx, "flow").Warn("sso provider dropped from step: no connection has the slug",
				slog.String("project_id", projectID),
				slog.String("step", stepName),
				slog.String("slug", slug),
			)
			continue
		}
		if err != nil {
			return nil, err
		}
		doc, err := domain.ParseIDPConnectionDocument(connection.Document)
		if err != nil {
			return nil, domain.ErrInternal(err).WithMessage("failed to read identity provider connection document")
		}
		provider := domain.FlowSSOProvider{ID: connection.Slug, Name: doc.DisplayName}
		if doc.Template != nil {
			provider.Template = *doc.Template
		}
		providers = append(providers, provider)
	}
	return providers, nil
}
