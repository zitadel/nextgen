package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/zitadel/nextgen/internal/domain"
)

// FlowSSOProviderResolver implements [domain.FlowSSOProviderResolver] over
// the connection service. When the request's release pins a flow, each slug
// is the revision that release pins, and a slug it does not pin is an
// internal error. Otherwise the step's slugs are read in one lookup, each at
// its newest revision, and a slug with no connection is dropped and logged
// with the step it came from.
type FlowSSOProviderResolver struct {
	connections IDPConnectionService
}

func NewFlowSSOProviderResolver(connections IDPConnectionService) *FlowSSOProviderResolver {
	return &FlowSSOProviderResolver{connections: connections}
}

var _ domain.FlowSSOProviderResolver = (*FlowSSOProviderResolver)(nil)

func (r *FlowSSOProviderResolver) Resolve(ctx context.Context, projectID, stepName string, slugs []string) ([]domain.FlowSSOProvider, error) {
	if ReleasePinsFlow(ctx) {
		return r.resolvePinned(ctx, projectID, slugs)
	}
	connections, err := r.connections.GetBySlugs(ctx, projectID, slugs)
	if err != nil {
		return nil, domain.ErrInternal(err).WithMessage("failed to read identity provider connections")
	}
	bySlug := indexByID(connections, func(c *domain.IDPConnection) string { return c.Slug })
	providers := make([]domain.FlowSSOProvider, 0, len(slugs))
	for _, slug := range slugs {
		connection, ok := bySlug[slug]
		if !ok {
			getLoggingContext(ctx, "flow").Warn("sso provider dropped from step: no connection has the slug",
				slog.String("project_id", projectID),
				slog.String("step", stepName),
				slog.String("slug", slug),
			)
			continue
		}
		provider, err := flowSSOProvider(connection)
		if err != nil {
			return nil, err
		}
		providers = append(providers, provider)
	}
	return providers, nil
}

func (r *FlowSSOProviderResolver) resolvePinned(ctx context.Context, projectID string, slugs []string) ([]domain.FlowSSOProvider, error) {
	providers := make([]domain.FlowSSOProvider, 0, len(slugs))
	for _, slug := range slugs {
		revisionID, err := pinnedIDPRevision(ctx, slug)
		if err != nil {
			return nil, err
		}
		connection, err := r.connections.GetRevision(ctx, projectID, revisionID)
		if err != nil {
			return nil, pinnedIDPReadError(slug, err)
		}
		provider, err := flowSSOProvider(connection)
		if err != nil {
			return nil, err
		}
		providers = append(providers, provider)
	}
	return providers, nil
}

// pinnedIDPRevision is the revision the request's release pins for slug.
func pinnedIDPRevision(ctx context.Context, slug string) (string, error) {
	revisionID, ok := PinsFor(ReleaseFromContext(ctx), domain.ReleasePointerKindIDP)[slug]
	if !ok {
		return "", domain.ErrInternal(nil).WithMessage(fmt.Sprintf("release does not pin identity provider %q", slug))
	}
	return revisionID, nil
}

func pinnedIDPReadError(slug string, err error) error {
	if errors.Is(err, domain.ErrIDPConnectionNotFound()) {
		return domain.ErrInternal(err).WithMessage(fmt.Sprintf("release pins a missing identity provider %q", slug))
	}
	return err
}

func flowSSOProvider(connection *domain.IDPConnection) (domain.FlowSSOProvider, error) {
	doc, err := domain.ParseIDPConnectionDocument(connection.Document)
	if err != nil {
		return domain.FlowSSOProvider{}, domain.ErrInternal(err).WithMessage("failed to read identity provider connection document")
	}
	provider := domain.FlowSSOProvider{ID: connection.Slug, Name: doc.DisplayName, ConnectionID: connection.ID}
	if doc.Template != nil {
		provider.Template = *doc.Template
	}
	return provider, nil
}
