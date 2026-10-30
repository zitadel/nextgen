package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
)

// FlowSSOProviderResolver implements [domain.FlowSSOProviderResolver] over
// the connection service, at the revisions the request's release pins.
type FlowSSOProviderResolver struct {
	connections IDPConnectionService
}

func NewFlowSSOProviderResolver(connections IDPConnectionService) *FlowSSOProviderResolver {
	return &FlowSSOProviderResolver{connections: connections}
}

var _ domain.FlowSSOProviderResolver = (*FlowSSOProviderResolver)(nil)

func (r *FlowSSOProviderResolver) Resolve(ctx context.Context, projectID string, slugs []string) ([]domain.FlowSSOProvider, error) {
	providers := make([]domain.FlowSSOProvider, 0, len(slugs))
	for _, slug := range slugs {
		connection, err := pinnedIDPConnection(ctx, r.connections, projectID, slug)
		if err != nil {
			return nil, err
		}
		provider, err := flowSSOProvider(connection)
		if err != nil {
			return nil, err
		}
		providers = append(providers, provider)
	}
	return providers, nil
}

// pinnedIDPConnection is the revision of slug the request's release pins.
func pinnedIDPConnection(ctx context.Context, connections IDPConnectionService, projectID, slug string) (*domain.IDPConnection, error) {
	pins, err := runtimePins(ctx, domain.ReleasePointerKindIDP)
	if err != nil {
		return nil, err
	}
	revisionID, ok := pins[slug]
	if !ok {
		return nil, domain.ErrInternal(nil).WithMessage(fmt.Sprintf("release does not pin identity provider %q", slug))
	}
	connection, err := connections.GetRevision(ctx, projectID, revisionID)
	if errors.Is(err, domain.ErrIDPConnectionNotFound()) {
		return nil, domain.ErrInternal(err).WithMessage(fmt.Sprintf("release pins a missing identity provider %q", slug))
	}
	return connection, err
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
