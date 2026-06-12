package helpers

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
	api "github.com/zitadel/nextgen/api/generated"
)

func (h *Harness) EnsureAPIClient(t *testing.T, projectID string) *api.Client {
	t.Helper()
	h.mu.Lock()
	if h.apiClients != nil {
		if client, ok := h.apiClients[projectID]; ok {
			h.mu.Unlock()
			return client
		}
	}
	h.mu.Unlock()

	serv := h.EnsureTestServer(t)
	client, err := api.NewClient(
		serv.URL,
		h.EnsureFakeSecuritySource(t, projectID),
	)
	require.NoError(t, err)
	h.mu.Lock()
	if h.apiClients == nil {
		h.apiClients = make(map[string]*api.Client)
	}
	if existing, ok := h.apiClients[projectID]; ok {
		h.mu.Unlock()
		return existing
	}
	h.apiClients[projectID] = client
	h.mu.Unlock()
	return client
}

func (h *Harness) EnsureAnonymousAPIClient(t *testing.T) *api.Client {
	t.Helper()
	h.mu.Lock()
	client := h.anonymousClient
	h.mu.Unlock()
	if client != nil {
		return client
	}

	serv := h.EnsureTestServer(t)
	client, err := api.NewClient(
		serv.URL,
		h.EnsureAnonymousSecuritySource(t),
	)
	require.NoError(t, err)
	h.mu.Lock()
	if h.anonymousClient == nil {
		h.anonymousClient = client
	}
	client = h.anonymousClient
	h.mu.Unlock()
	return client
}

func (h *Harness) EnsureFakeSecuritySource(t *testing.T, projectID string) *FakeSecuritySource {
	t.Helper()
	h.mu.Lock()
	if h.fakeSecuritySources != nil {
		if source, ok := h.fakeSecuritySources[projectID]; ok {
			h.mu.Unlock()
			return source
		}
	}
	h.mu.Unlock()

	source := &FakeSecuritySource{
		projectID: projectID,
	}
	h.mu.Lock()
	if h.fakeSecuritySources == nil {
		h.fakeSecuritySources = make(map[string]*FakeSecuritySource)
	}
	if source, ok := h.fakeSecuritySources[projectID]; ok {
		h.mu.Unlock()
		return source
	}
	h.fakeSecuritySources[projectID] = source
	h.mu.Unlock()
	return source
}

func (h *Harness) EnsureAnonymousSecuritySource(t *testing.T) *FakeSecuritySource {
	t.Helper()
	h.mu.Lock()
	source := h.anonymousSecuritySource
	h.mu.Unlock()
	if source != nil {
		return source
	}
	source = &FakeSecuritySource{}
	h.mu.Lock()
	if h.anonymousSecuritySource == nil {
		h.anonymousSecuritySource = source
	}
	source = h.anonymousSecuritySource
	h.mu.Unlock()
	return source
}

type FakeSecuritySource struct {
	projectID string
}

func (f FakeSecuritySource) OAuth2(ctx context.Context, operationName api.OperationName) (api.OAuth2, error) {
	return api.OAuth2{
		Token:  fmt.Sprintf("sk_%s", f.projectID),
		Scopes: []string{"all"},
	}, nil
}

func (f FakeSecuritySource) UsernamePassword(ctx context.Context, operationName api.OperationName) (api.UsernamePassword, error) {
	return api.UsernamePassword{
		Username: "TEST_USER",
		Password: "TEST_PASSWORD",
		Roles:    []string{"all"},
	}, nil
}

var _ api.SecuritySource = (*FakeSecuritySource)(nil)

type AnonymousSecuritySource struct {
}

func (f AnonymousSecuritySource) OAuth2(ctx context.Context, operationName api.OperationName) (api.OAuth2, error) {
	return api.OAuth2{}, nil
}

func (f AnonymousSecuritySource) UsernamePassword(ctx context.Context, operationName api.OperationName) (api.UsernamePassword, error) {
	return api.UsernamePassword{}, nil
}

var _ api.SecuritySource = (*FakeSecuritySource)(nil)
