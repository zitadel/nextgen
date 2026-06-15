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
	defer h.mu.Unlock()
	serv := h.EnsureTestServer(t)
	if h.apiClients == nil {
		h.apiClients = make(map[string]*api.Client)
	}
	if client, ok := h.apiClients[projectID]; ok {
		return client
	}
	client, err := api.NewClient(
		serv.URL,
		h.ensureFakeSecuritySourceLocked(projectID),
	)
	require.NoError(t, err)
	h.apiClients[projectID] = client
	return client
}

func (h *Harness) EnsureAnonymousAPIClient(t *testing.T) *api.Client {
	t.Helper()
	h.mu.Lock()
	defer h.mu.Unlock()
	serv := h.EnsureTestServer(t)
	if h.anonymousClient == nil {
		client, err := api.NewClient(
			serv.URL,
			h.ensureAnonymousSecuritySourceLocked(),
		)
		require.NoError(t, err)
		h.anonymousClient = client
	}
	return h.anonymousClient
}

func (h *Harness) EnsureFakeSecuritySource(t *testing.T, projectID string) *FakeSecuritySource {
	t.Helper()
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.ensureFakeSecuritySourceLocked(projectID)
}

func (h *Harness) ensureFakeSecuritySourceLocked(projectID string) *FakeSecuritySource {
	if h.fakeSecuritySources == nil {
		h.fakeSecuritySources = make(map[string]*FakeSecuritySource)
	}
	if source, ok := h.fakeSecuritySources[projectID]; ok {
		return source
	}
	h.fakeSecuritySources[projectID] = &FakeSecuritySource{
		projectID: projectID,
	}
	return h.fakeSecuritySources[projectID]
}

func (h *Harness) EnsureAnonymousSecuritySource(t *testing.T) *FakeSecuritySource {
	t.Helper()
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.ensureAnonymousSecuritySourceLocked()
}

func (h *Harness) ensureAnonymousSecuritySourceLocked() *FakeSecuritySource {
	if h.anonymousSecuritySource == nil {
		h.anonymousSecuritySource = &FakeSecuritySource{}
	}
	return h.anonymousSecuritySource
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
