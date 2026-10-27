package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/zitadel/nextgen/internal/domain"
)

// FlowSSOProviderResolver implements [domain.FlowSSOProviderResolver] over
// the connection service. Each slug is the revision the request's release
// pins, and a slug it does not pin is an internal error. A request with no
// release is not deployed.
type FlowSSOProviderResolver struct {
	connections IDPConnectionService
}

func NewFlowSSOProviderResolver(connections IDPConnectionService) *FlowSSOProviderResolver {
	return &FlowSSOProviderResolver{connections: connections}
}

var _ domain.FlowSSOProviderResolver = (*FlowSSOProviderResolver)(nil)

func (r *FlowSSOProviderResolver) Resolve(ctx context.Context, projectID, _ string, slugs []string) ([]domain.FlowSSOProvider, error) {
	if _, err := runtimePins(ctx, domain.ReleasePointerKindIDP); err != nil {
		return nil, err
	}
	return r.resolvePinned(ctx, projectID, slugs)
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
	pins, err := runtimePins(ctx, domain.ReleasePointerKindIDP)
	if err != nil {
		return "", err
	}
	revisionID, ok := pins[slug]
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
